// Strict input validator for the /trigger/readymode endpoint. Exists
// because upstream once posted `attempts: "(times_called)"` — an
// unsubstituted template placeholder — and `Number("(times_called)") < 40`
// is `false`, so the attempts gatekeeper silently let it through and we
// texted leads we shouldn't have. The validator bounces anything that
// doesn't look like a real, fully-substituted payload.
//
// Two contamination signatures we explicitly catch:
//   1. Placeholder syntax — value matches `(some_identifier)` exactly.
//      Reject on ANY string field, not just the load-bearing ones — a
//      placeholder anywhere is a strong upstream-template-broken signal.
//   2. Phone with embedded key=value text. The legacy digit-strip happily
//      turned "primaryPhone=(203) 360-9279" into "2033609279" (a real
//      phone), masking the bug.

import { normalizePhone } from "@shared/util/phone.ts";

export interface TriggerPayloadDto {
  phone: string; // normalized 10-digit
  // integer >= 0 (forced to 0 under override). `undefined` means upstream
  // sent the literal `(times_called)` placeholder — the service is expected
  // to look the real value up via the RM TPI client before applying the
  // attempts gate. Any OTHER placeholder or non-numeric value still fails
  // validation; only that one known-broken template token is whitelisted.
  attempts: number | undefined;
  resID: string;
  dialerDomain: string; // lowercased, one of KNOWN_DIALER_DOMAINS
  override: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  campaign?: string;
  office?: string;
  destination?: string;
  totalPrice?: string;
  leadDate?: string;
  urlLinkToRecord?: string;
  notes?: string;
  // Pass-through for fields the downstream mapper consumes that aren't
  // worth strongly typing here (Custom_*, desiredDestination1, etc).
  // Each is still checked for placeholder syntax.
  [key: string]: unknown;
}

export interface ValidationError {
  field: string;
  reason: string;
  value: unknown;
}

export type ValidationResult =
  | { ok: true; dto: TriggerPayloadDto }
  | { ok: false; error: ValidationError };

// Mirror the resolveDomain switch in service.ts. Kept here as a literal
// list (not imported) so the validator can run with no DB or env deps.
const KNOWN_DIALER_DOMAINS = new Set([
  "monsterrg",
  "readymodemonster",
  "monsterodr",
  "readymodeodr",
  "monsteract",
  "monsterds",
  "monsterods",
]);

const PLACEHOLDER_RE = /^\([a-zA-Z][a-zA-Z0-9_]*\)$/;

// The one specific placeholder we know upstream RM template breaks on —
// `attempts=(times_called)`. We don't reject this anymore; the service
// looks up the real attempts value via the TPI client. Other placeholders
// in the attempts field, or this token in OTHER fields, still fail.
const ATTEMPTS_LOOKUP_TOKEN = "(times_called)";

// Fields we want to type-check or surface in the DTO. Other keys pass
// through verbatim (after the placeholder sweep).
const STRING_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "campaign",
  "office",
  "destination",
  "totalPrice",
  "leadDate",
  "urlLinkToRecord",
  "notes",
] as const;

function isPlaceholder(v: unknown): boolean {
  return typeof v === "string" && PLACEHOLDER_RE.test(v.trim());
}

function fail(field: string, reason: string, value: unknown): ValidationResult {
  return { ok: false, error: { field, reason, value } };
}

function parseOverride(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
}

function parseAttempts(raw: unknown): number | null {
  // Reject placeholder explicitly before Number() coerces it to NaN.
  if (isPlaceholder(raw)) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    // Digit-only string (no decimals, no signs, no garbage).
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

export function parseTriggerPayload(
  raw: Record<string, unknown>,
): ValidationResult {
  const override = parseOverride(raw.override);

  // --- phone ---------------------------------------------------------------
  const phoneRaw = (raw.phone ?? raw.primaryPhone ?? raw.Phone) as unknown;
  if (typeof phoneRaw !== "string" || phoneRaw.trim() === "") {
    return fail("phone", "required", phoneRaw);
  }
  if (isPlaceholder(phoneRaw)) {
    return fail("phone", "looks like an unsubstituted placeholder", phoneRaw);
  }
  // Contamination check: real phones never contain "=" or letters beyond
  // standard formatting characters. Allowed: digits, spaces, parens,
  // hyphens, dots, leading "+". Anything else (letters, "=", "&") is
  // upstream junk.
  if (/[^0-9 ()+\-. ]/.test(phoneRaw)) {
    return fail(
      "phone",
      "contains non-phone characters (likely upstream template contamination)",
      phoneRaw,
    );
  }
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return fail("phone", "could not normalize to 10 digits", phoneRaw);
  }

  // --- dialerDomain --------------------------------------------------------
  const dialerDomainRaw = (raw.dialerDomain ?? raw.domain) as unknown;
  if (typeof dialerDomainRaw !== "string" || dialerDomainRaw.trim() === "") {
    return fail("dialerDomain", "required", dialerDomainRaw);
  }
  if (isPlaceholder(dialerDomainRaw)) {
    return fail(
      "dialerDomain",
      "looks like an unsubstituted placeholder",
      dialerDomainRaw,
    );
  }
  const dialerDomain = dialerDomainRaw.toLowerCase().trim();
  if (!KNOWN_DIALER_DOMAINS.has(dialerDomain)) {
    return fail(
      "dialerDomain",
      `unknown domain (expected one of ${
        [...KNOWN_DIALER_DOMAINS].join(", ")
      })`,
      dialerDomainRaw,
    );
  }

  // --- resID ---------------------------------------------------------------
  const resIDRaw = (raw.resID ?? raw.Custom_56) as unknown;
  if (
    resIDRaw === undefined || resIDRaw === null ||
    (typeof resIDRaw === "string" && resIDRaw.trim() === "")
  ) {
    return fail("resID", "required", resIDRaw);
  }
  if (isPlaceholder(resIDRaw)) {
    return fail("resID", "looks like an unsubstituted placeholder", resIDRaw);
  }
  const resID = String(resIDRaw).trim();

  // --- attempts ------------------------------------------------------------
  // Required UNLESS override is set, which is the QA / manual-test escape
  // hatch and intentionally bypasses every gatekeeper downstream. When
  // override is on we still record attempts as 0 so the DTO type stays
  // honest where possible.
  //
  // Special case: the literal token `(times_called)` is whitelisted and
  // becomes `undefined`. RM's webhook template is broken in production —
  // they ship the unsubstituted placeholder. The service handles this by
  // looking the real value up via the TPI client before applying the
  // attempts gate. Any OTHER placeholder, missing value, or non-numeric
  // string in this field still fails: those would be a different bug.
  let attempts: number | undefined;
  if (override) {
    if (
      typeof raw.attempts === "string" &&
      raw.attempts.trim() === ATTEMPTS_LOOKUP_TOKEN
    ) {
      attempts = undefined;
    } else {
      const parsed = parseAttempts(raw.attempts);
      attempts = parsed ?? 0;
    }
  } else {
    if (raw.attempts === undefined || raw.attempts === null) {
      return fail("attempts", "required (no override)", raw.attempts);
    }
    if (
      typeof raw.attempts === "string" &&
      raw.attempts.trim() === ATTEMPTS_LOOKUP_TOKEN
    ) {
      console.log(
        `[trigger] ⚠️ attempts is the known-broken (times_called) placeholder — will look up via TPI`,
      );
      attempts = undefined;
    } else {
      const parsed = parseAttempts(raw.attempts);
      if (parsed === null) {
        return fail(
          "attempts",
          "must be a non-negative integer (got non-numeric, or a placeholder other than (times_called))",
          raw.attempts,
        );
      }
      attempts = parsed;
    }
  }

  // --- placeholder sweep on every other string field -----------------------
  // Apply to known fields first for typed surfacing, then to any remaining
  // string keys for blast-radius coverage.
  const dto: TriggerPayloadDto = {
    ...raw,
    phone,
    attempts,
    resID,
    dialerDomain,
    override,
  };

  for (const f of STRING_FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") {
      return fail(f, "must be a string", v);
    }
    if (isPlaceholder(v)) {
      return fail(f, "looks like an unsubstituted placeholder", v);
    }
  }
  // Catch-all: scan every string field for placeholder syntax. Skips ones
  // already validated above.
  const checked = new Set<string>([
    "phone",
    "primaryPhone",
    "Phone",
    "dialerDomain",
    "domain",
    "resID",
    "Custom_56",
    "attempts",
    "override",
    ...STRING_FIELDS,
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (checked.has(k)) continue;
    if (isPlaceholder(v)) {
      return fail(k, "looks like an unsubstituted placeholder", v);
    }
  }

  return { ok: true, dto };
}
