// ReadyMode TPI lookup client. RM's outbound webhook template ships the
// literal `attempts=(times_called)` placeholder instead of the real call
// count — they own the template, we can't fix it. This module fetches
// the real value via their search/get TPI endpoints when the trigger
// service asks for it.
//
// Two HTTP calls per lookup:
//   1. GET /TPI/search/lead/{phone10} → JSON map keyed "Profile,<id>" /
//      "Lead,<id>". We pick max(itemId) among entries with typeId="Lead".
//   2. GET /TPI/get/lead/{leadId} → full lead. We pull result["times called"]
//      (key has a space; lowercase).
//
// Three throttle guards in front, each gate-check before any HTTP:
//   • Min spacing between calls (1s default). Caller waits, but only up
//     to MAX_WAIT_MS — past that we fail with `tpi-spacing-wait-too-long`
//     so we don't backlog inbound triggers.
//   • Sliding 5-minute cap (30 calls default). Fails fast — no waiting,
//     caller decides what to do.
//   • Circuit breaker. 5 consecutive non-2xx / network errors → open for
//     60s. Open state fails instantly without touching the other guards
//     so a flapping RM doesn't burn our 5-min budget.
//
// All three are tunable via env vars but have safe defaults that fit
// the operator's "100 leads/day at 40+ attempts" steady-state and won't
// crater RM if a wave hits at once.

import { getRmCreds } from "@shared/services/readymode/auth.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

const TPI_MIN_SPACING_MS = Number(
  Deno.env.get("RM_TPI_MIN_SPACING_MS") ?? 1000,
);
const TPI_MAX_PER_5MIN = Number(Deno.env.get("RM_TPI_MAX_PER_5MIN") ?? 30);
const TPI_MAX_WAIT_MS = Number(Deno.env.get("RM_TPI_MAX_WAIT_MS") ?? 5000);
const TPI_CIRCUIT_THRESHOLD = Number(
  Deno.env.get("RM_TPI_CIRCUIT_THRESHOLD") ?? 5,
);
const TPI_CIRCUIT_OPEN_MS = Number(
  Deno.env.get("RM_TPI_CIRCUIT_OPEN_MS") ?? 60_000,
);
const TPI_HTTP_TIMEOUT_MS = Number(
  Deno.env.get("RM_TPI_HTTP_TIMEOUT_MS") ?? 10_000,
);
const WINDOW_MS = 5 * 60 * 1000;

// Module-level state. Per-isolate (Deno Deploy fans out across regions,
// so the budget is best-effort per-isolate — acceptable for our volume).
let lastCallAt = 0;
const recentCalls: number[] = []; // timestamps within WINDOW_MS
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export interface TpiThrottleSnapshot {
  now: number;
  windowMs: number;
  maxPer5Min: number;
  callsInWindow: number;
  msSinceLast: number;
  minSpacingMs: number;
  circuitOpen: boolean;
  circuitOpenUntil: number;
  consecutiveFailures: number;
  circuitThreshold: number;
}

export function getTpiThrottleSnapshot(): TpiThrottleSnapshot {
  const now = Date.now();
  pruneWindow(now);
  return {
    now,
    windowMs: WINDOW_MS,
    maxPer5Min: TPI_MAX_PER_5MIN,
    callsInWindow: recentCalls.length,
    msSinceLast: lastCallAt === 0 ? -1 : now - lastCallAt,
    minSpacingMs: TPI_MIN_SPACING_MS,
    circuitOpen: now < circuitOpenUntil,
    circuitOpenUntil,
    consecutiveFailures,
    circuitThreshold: TPI_CIRCUIT_THRESHOLD,
  };
}

function pruneWindow(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (recentCalls.length > 0 && recentCalls[0] < cutoff) recentCalls.shift();
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= TPI_CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + TPI_CIRCUIT_OPEN_MS;
    console.warn(
      `[tpi] 🚨 circuit OPEN until ${
        new Date(circuitOpenUntil).toISOString()
      } ` +
        `(${consecutiveFailures} consecutive failures)`,
    );
  }
}

// Acquire a token through all three guards. Returns `null` on success
// (call may proceed) or a reason string on failure (caller bails). The
// token is "consumed" on success — we update `lastCallAt` and append to
// `recentCalls` BEFORE the HTTP fires, so a stuck call still counts
// against the budget.
async function acquireToken(): Promise<string | null> {
  const now = Date.now();

  // Circuit first — cheapest check, and if open we don't burn the
  // 5-min budget OR consume spacing.
  if (now < circuitOpenUntil) {
    return "tpi-circuit-open";
  }

  // Sliding window.
  pruneWindow(now);
  if (recentCalls.length >= TPI_MAX_PER_5MIN) {
    return "tpi-window-cap-reached";
  }

  // Min spacing — wait if needed, but cap the wait. Bursts of inbound
  // triggers shouldn't queue up beyond MAX_WAIT_MS or our /trigger
  // endpoint starts timing out.
  if (lastCallAt !== 0) {
    const sinceLast = now - lastCallAt;
    if (sinceLast < TPI_MIN_SPACING_MS) {
      const waitMs = TPI_MIN_SPACING_MS - sinceLast;
      if (waitMs > TPI_MAX_WAIT_MS) {
        return "tpi-spacing-wait-too-long";
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  const reservedAt = Date.now();
  lastCallAt = reservedAt;
  recentCalls.push(reservedAt);
  return null;
}

function basicAuth(user: string, pass: string): string {
  return "Basic " + btoa(`${user}:${pass}`);
}

function subdomainFor(domain: DialerDomain): string {
  // Enum value IS the subdomain (monsteract, monsterodr, …). Lowercase
  // to be safe in case anyone ever passes a custom variant.
  return String(domain).toLowerCase();
}

export interface TpiSearchEntry {
  typeId: string;
  itemId: string | number;
  [key: string]: unknown;
}

// Raw search response parser. Exposed for the test endpoint so the
// operator can hand-fire and inspect the structure.
export function pickBiggestLeadId(
  searchResponse: Record<string, unknown>,
): number | null {
  let bestId: number | null = null;
  for (const v of Object.values(searchResponse)) {
    if (!v || typeof v !== "object") continue;
    const entry = v as TpiSearchEntry;
    if (entry.typeId !== "Lead") continue;
    const idNum = typeof entry.itemId === "number"
      ? entry.itemId
      : Number(entry.itemId);
    if (!Number.isFinite(idNum) || !Number.isInteger(idNum)) continue;
    if (bestId === null || idNum > bestId) bestId = idNum;
  }
  return bestId;
}

// Raw get response parser. Exposed for the test endpoint.
export function extractTimesCalled(
  getResponse: Record<string, unknown>,
): number | null {
  const result = getResponse.result;
  if (!result || typeof result !== "object") return null;
  const raw = (result as Record<string, unknown>)["times called"];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

async function httpGetJson(
  url: string,
  authHeader: string,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; reason: string }
> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": authHeader, "Accept": "application/json" },
      signal: AbortSignal.timeout(TPI_HTTP_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      // Drain body so the connection releases — don't care about content.
      await res.text().catch(() => "");
      return { ok: false, reason: `http-${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: true, json };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return { ok: false, reason: `fetch-error:${msg.slice(0, 80)}` };
  }
}

export interface FetchAttemptsResult {
  ok: true;
  attempts: number;
  leadId: number;
}

export interface FetchAttemptsFailure {
  ok: false;
  reason: string;
}

// Per-phone attempts lookup. Goes through the full throttle stack and
// the circuit breaker. Use this from the live trigger path.
export async function fetchAttemptsFromTpi(
  phone10: string,
  domain: DialerDomain,
): Promise<FetchAttemptsResult | FetchAttemptsFailure> {
  if (!/^\d{10}$/.test(phone10)) {
    return { ok: false, reason: "invalid-phone" };
  }

  const gate = await acquireToken();
  if (gate !== null) {
    console.warn(`[tpi] ⛔ throttled phone=${phone10} reason=${gate}`);
    return { ok: false, reason: gate };
  }

  let creds;
  try {
    creds = getRmCreds(domain);
  } catch (e) {
    console.error(
      `[tpi] ❌ creds missing for ${domain}: ${(e as Error).message}`,
    );
    return { ok: false, reason: "no-creds" };
  }
  const auth = basicAuth(creds.user, creds.pass);
  const sub = subdomainFor(domain);
  const start = Date.now();

  // Search
  const searchUrl =
    `https://${sub}.readymode.com/TPI/search/lead/${phone10}?API_user=${
      encodeURIComponent(creds.user)
    }&API_pass=${encodeURIComponent(creds.pass)}`;
  const searchRes = await httpGetJson(searchUrl, auth);
  if (!searchRes.ok) {
    recordFailure();
    console.warn(
      `[tpi] ❌ search failed phone=${phone10} domain=${domain} reason=${searchRes.reason}`,
    );
    return { ok: false, reason: `search:${searchRes.reason}` };
  }
  const leadId = pickBiggestLeadId(searchRes.json);
  if (leadId === null) {
    // Not a transport failure — counts as success for circuit purposes.
    // RM responded fine, the phone just has no Lead entry. Common case
    // for fresh leads RM dropped from their dialer rotation.
    recordSuccess();
    console.warn(
      `[tpi] ⚠️ no-lead-in-rm phone=${phone10} domain=${domain} ` +
        `keys=${Object.keys(searchRes.json).join(",")}`,
    );
    return { ok: false, reason: "no-lead-in-rm" };
  }

  // Get
  const getUrl =
    `https://${sub}.readymode.com/TPI/get/lead/${leadId}?API_user=${
      encodeURIComponent(creds.user)
    }&API_pass=${encodeURIComponent(creds.pass)}`;
  const getRes = await httpGetJson(getUrl, auth);
  if (!getRes.ok) {
    recordFailure();
    console.warn(
      `[tpi] ❌ get failed phone=${phone10} leadId=${leadId} reason=${getRes.reason}`,
    );
    return { ok: false, reason: `get:${getRes.reason}` };
  }
  const attempts = extractTimesCalled(getRes.json);
  if (attempts === null) {
    recordSuccess(); // RM responded, just doesn't have a usable field.
    console.warn(
      `[tpi] ⚠️ no-times-called phone=${phone10} leadId=${leadId} result=${
        JSON.stringify(getRes.json.result).slice(0, 200)
      }`,
    );
    return { ok: false, reason: "no-times-called-field" };
  }

  recordSuccess();
  const elapsed = Date.now() - start;
  console.log(
    `[tpi] ✅ phone=${phone10} domain=${domain} leadId=${leadId} ` +
      `attempts=${attempts} elapsed=${elapsed}ms`,
  );
  return { ok: true, attempts, leadId };
}

// Untrottled, low-level callers for the test endpoints. These bypass
// the bucket/circuit on purpose — the operator wants to inspect raw RM
// responses during discovery. Each still tags itself loudly in logs so
// it's obvious we're not in the production path.

export async function rawSearch(
  phone10: string,
  domain: DialerDomain,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; reason: string }
> {
  const creds = getRmCreds(domain);
  const sub = subdomainFor(domain);
  const url =
    `https://${sub}.readymode.com/TPI/search/lead/${phone10}?API_user=${
      encodeURIComponent(creds.user)
    }&API_pass=${encodeURIComponent(creds.pass)}`;
  console.log(`[tpi-test] 🔬 raw search phone=${phone10} domain=${domain}`);
  return await httpGetJson(url, basicAuth(creds.user, creds.pass));
}

export async function rawGet(
  leadId: number,
  domain: DialerDomain,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; reason: string }
> {
  const creds = getRmCreds(domain);
  const sub = subdomainFor(domain);
  const url = `https://${sub}.readymode.com/TPI/get/lead/${leadId}?API_user=${
    encodeURIComponent(creds.user)
  }&API_pass=${encodeURIComponent(creds.pass)}`;
  console.log(`[tpi-test] 🔬 raw get leadId=${leadId} domain=${domain}`);
  return await httpGetJson(url, basicAuth(creds.user, creds.pass));
}

// Internal hooks ONLY for tests — lets the unit suite reset module state
// between cases. Production never calls these.
export function __resetTpiStateForTests(): void {
  lastCallAt = 0;
  recentCalls.length = 0;
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}
