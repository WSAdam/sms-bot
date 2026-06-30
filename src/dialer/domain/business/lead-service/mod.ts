// Main SMS pipeline orchestrator. Ports
// _source-omnisource/sms-flow/readymode/service/mod.ts to plain Deno.
//
// Strips NestJS decorators, replaces node:http(s) with fetch, fails fast on
// missing RM creds (no `adam`/`Winter123` defaults), reads BLAND_PATHWAY_VERSION
// from env so we can flip off "production" without a code change.

import {
  BLAND_AGENT_NUMBER,
  GLOBAL_DAILY_SMS_CAP,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";
import {
  globalSmsCountDocPath,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  smsFlowContextDocPath,
  uniqueRecipientByPhoneDocPath,
  weeklyRecipientByPhoneWeekDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
  withCounterFailureFlag,
} from "@shared/firestore/wrapper.ts";
import { getAndToggleVariant } from "@shared/services/ab-test/service.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import * as bland from "@shared/services/bland/client.ts";
import * as conversations from "@shared/services/conversations/store.ts";
import { findGuestByResId } from "@shared/services/crm/reservations.ts";
import { isDnc } from "@shared/services/dnc/service.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import {
  checkAndReserve as rateLimitCheckAndReserve,
  checkOnly as rateLimitCheck,
  release as rateLimitRelease,
  reserve as rateLimitReserve,
  schedule as rateLimitSchedule,
} from "@shared/services/rate-limiter/service.ts";
import { getRmCreds } from "@dialer/domain/data/rm-auth/mod.ts";
import { DOMAIN_CONFIG } from "@dialer/domain/business/domain-config/mod.ts";
import { fetchAttemptsFromTpi } from "@dialer/domain/data/tpi-client/mod.ts";
import {
  denormalize,
  leadFieldFor,
  normalize,
} from "@dialer/domain/business/mapping/mod.ts";
import {
  DialerDomain,
  type ReadymodeLeadDto,
  type ReadymodeResponseDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";
import {
  easternDateString,
  easternMondayDateString,
} from "@shared/util/time.ts";

function resolveDomain(input: string | undefined | null): DialerDomain {
  const v = (input ?? "").toLowerCase().trim();
  switch (v) {
    case "monsterrg":
    case "readymodemonster":
      return DialerDomain.MONSTER;
    case "monsterodr":
    case "readymodeodr":
      return DialerDomain.ODR;
    case "monsteract":
      return DialerDomain.ACT;
    case "monsterds":
      return DialerDomain.DS;
    case "monsterods":
      return DialerDomain.ODS;
    default:
      console.warn(
        `[trigger] Unknown dialerDomain '${input}', defaulting to MONSTER`,
      );
      return DialerDomain.MONSTER;
  }
}

async function getGlobalDailyCount(
  client: FirestoreClient,
): Promise<number> {
  try {
    const today = easternDateString();
    const r = await client.get(globalSmsCountDocPath(today));
    return typeof r?.count === "number" ? r.count : 0;
  } catch (e) {
    console.error("[trigger] read global count failed:", e);
    return 0;
  }
}

async function incrementGlobalDailyCount(
  client: FirestoreClient,
): Promise<void> {
  // Atomic FieldValue.increment — concurrent calls are race-free.
  // updatedAt is a separate non-atomic merge; benign if it races.
  // Only the override path uses this now; the normal send path reserves a
  // slot atomically before the send (reserveGlobalDailySlot).
  const today = easternDateString();
  const path = globalSmsCountDocPath(today);
  await client.incrementField(path, { count: 1 });
  await client.setMerge(path, { updatedAt: new Date().toISOString() });
}

// Atomically reserve one slot against the global daily cap. Reads the current
// count and increments it ONLY when still under `cap`, all inside a single
// Firestore transaction — so N concurrent requests can't all read the same
// sub-cap count, all pass, and collectively overshoot the cap. Returns true
// when this caller got a slot, false when the cap is already reached.
// Fail-open (returns true) on a transaction error, matching the read-only
// gate's behavior, so Firestore being unreachable never hard-blocks sends.
async function reserveGlobalDailySlot(
  client: FirestoreClient,
  cap: number,
): Promise<boolean> {
  const today = easternDateString();
  const path = globalSmsCountDocPath(today);
  try {
    let reserved = false;
    await client.transactionalUpdate(path, (existing) => {
      const count = typeof existing?.count === "number" ? existing.count : 0;
      if (count >= cap) {
        reserved = false;
        return existing ?? { count };
      }
      reserved = true;
      return {
        ...(existing ?? {}),
        count: count + 1,
        updatedAt: new Date().toISOString(),
      };
    });
    return reserved;
  } catch (e) {
    console.error("[trigger] reserveGlobalDailySlot failed, fail-open:", e);
    return true;
  }
}

// Release a slot reserved by reserveGlobalDailySlot (used when the send fails
// after the slot was claimed). Best-effort; never lets count go negative.
async function releaseGlobalDailySlot(
  client: FirestoreClient,
): Promise<void> {
  const today = easternDateString();
  const path = globalSmsCountDocPath(today);
  try {
    await client.transactionalUpdate(path, (existing) => {
      const count = typeof existing?.count === "number" ? existing.count : 0;
      return {
        ...(existing ?? {}),
        count: Math.max(0, count - 1),
        updatedAt: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error("[trigger] releaseGlobalDailySlot failed (non-fatal):", e);
  }
}

// Exported for tests — the atomic cap reservation is a race-fix site, so it's
// covered directly rather than only via the full Bland-dependent trigger flow.
export const _reserveGlobalDailySlotForTest = reserveGlobalDailySlot;
export const _releaseGlobalDailySlotForTest = releaseGlobalDailySlot;

interface ProcessLeadResult {
  status: "success" | "skipped" | "error";
  message?: string;
  reason?: string;
  variant?: "A" | "B";
  attempts?: number;
}

export async function processInboundLead(
  rawData: Record<string, unknown>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<ProcessLeadResult> {
  console.log(
    `[trigger] 📥 incoming: ${JSON.stringify(rawData).slice(0, 600)}`,
  );

  const domain = resolveDomain(
    (rawData.dialerDomain as string) ?? (rawData.domain as string),
  );
  const lead = normalize(domain, rawData);
  // RM-trigger callers go through parseTriggerPayload which already
  // normalizes phone to 10 digits — `lead.phone` is the truth here. The
  // `primaryPhone` fallback exists for the manual/QA trigger route, which
  // doesn't (yet) go through the validator and may pass a formatted string.
  // Route both through normalizePhone instead of an inline strip so we
  // don't accidentally salvage contaminated input like "key=(123)...".
  const phone = lead.phone || normalizePhone(rawData.primaryPhone) || "";
  const resIdString = lead.reservationId ||
    String(rawData.resID ?? rawData.Custom_56 ?? "");
  // Attempts is `undefined` when the validator saw the known-broken
  // (times_called) placeholder. We look it up via RM's TPI after the
  // cheap deterministic gates pass — see the lookup branch below. For
  // any other shape the validator already enforced a number or rejected.
  const attemptsRaw = rawData.attempts ?? rawData.times_called;
  let attempts: number | undefined = attemptsRaw === undefined ||
      attemptsRaw === null
    ? undefined
    : (() => {
      const n = Number(attemptsRaw);
      return Number.isFinite(n) ? n : undefined;
    })();

  if (!phone) {
    return { status: "error", message: "Missing phone number" };
  }

  const isOverride = String(rawData.override).toLowerCase() === "true" ||
    rawData.override === true;
  if (isOverride) {
    console.log("[trigger] 🚨 OVERRIDE bypassing all gatekeepers");
  }

  // Gates 1 + 2 read from gatesConfig (Firestore-backed, dashboard-editable,
  // falls back to the constants in shared/config/constants.ts). One read
  // covers both gates — gates-config caches for 60s internally.
  const gates = await getGatesConfig(client);

  // Gatekeeper 1: attempts — only fires when we already know the value.
  // If `attempts` is undefined (RM template broken), the lookup branch
  // below resolves it AFTER the cheap deterministic gates so we don't
  // burn TPI calls on phones we wouldn't text regardless.
  if (
    !isOverride && attempts !== undefined && attempts < gates.attemptsThreshold
  ) {
    return { status: "skipped", reason: "Insufficient attempts", attempts };
  }

  // Gatekeeper 2: global daily cap. Precedence: env var > gatesConfig >
  // hardcoded default. The env override stays so Deno Deploy's existing
  // GLOBAL_DAILY_SMS_CAP setting still works for staged rollout testing.
  // The read-only check here is a cheap fail-fast; the AUTHORITATIVE,
  // race-free reservation happens atomically right before the send below
  // (reserveGlobalDailySlot) so concurrent requests can't collectively
  // overshoot the cap.
  const envCap = loadEnv().globalDailySmsCap;
  const globalDailyCap = envCap !== GLOBAL_DAILY_SMS_CAP
    ? envCap
    : gates.globalDailySmsCap;
  if (!isOverride) {
    const dailyCount = await getGlobalDailyCount(client);
    if (dailyCount >= globalDailyCap) {
      console.log(
        `[trigger] ⛔ daily cap reached: ${dailyCount}/${globalDailyCap} — skipped`,
      );
      return { status: "skipped", reason: "Global Daily Limit Reached" };
    }
  }

  // CRM enrichment. Real Quickbase lookup populates name/email/DNC. With the
  // stub client (or any time CRM returns nothing) we either skip the lead OR,
  // if override=true, fall through with a placeholder guest so the QA test
  // path can exercise the full Bland flow without Quickbase being wired up.
  let guest = await findGuestByResId(Number(resIdString));
  if (!guest) {
    if (!isOverride) {
      console.warn(
        `[trigger] guest not found for ResID ${resIdString} — skipping`,
      );
      return { status: "skipped", reason: "Guest Not Found" };
    }
    console.warn(
      `[trigger] guest not found for ResID ${resIdString} — using stub (override=true)`,
    );
    guest = {
      ReservationId: Number(resIdString) || 0,
      GuestFullName: "Test Guest",
      SpouseFullName: "",
      SpouseName: "",
      AskTcpaVerbiage: "",
      EmailAddress: "test@example.com",
      Dnc: false,
      MostRecentPackageIdDateOfBooking: "",
      MostRecentPackageIdCreditCardType: "",
      MostRecentPackageIdLast4OfCreditCardOnly: "",
    };
  }
  if (guest.Dnc && !isOverride) {
    return { status: "skipped", reason: "DNC" };
  }

  // Gatekeeper 3: opt-out (Firestore DNC + per-message doNotText)
  if (!isOverride) {
    if (await isDnc(phone)) return { status: "skipped", reason: "Opted Out" };
    if (await conversations.checkIfOptedOut(phone)) {
      return { status: "skipped", reason: "Opted Out" };
    }
  }

  // Gatekeeper 4: 30-day rate limit
  if (!isOverride) {
    if (!(await rateLimitCheck(phone))) {
      return { status: "skipped", reason: "Rate Limited" };
    }
  }

  // TPI attempts lookup — only when upstream failed to substitute the
  // (times_called) placeholder. All deterministic pre-flight gates have
  // already passed, so we know we'd text this phone if attempts qualifies.
  // On lookup failure (timeout, circuit open, throttled, no lead in RM):
  // 200 + skipped, never silently fall through to texting an unqualified
  // lead. Override path skips the lookup entirely.
  if (!isOverride && attempts === undefined) {
    const r = await fetchAttemptsFromTpi(phone, domain, client);
    if (!r.ok) {
      console.warn(`[trigger] ❌ TPI lookup failed for ${phone}: ${r.reason}`);
      return { status: "skipped", reason: `attempts-unknown:${r.reason}` };
    }
    attempts = r.attempts;
    console.log(
      `[trigger] ✅ TPI looked up attempts=${attempts} for ${phone} ` +
        `(leadId=${r.leadId})`,
    );
    if (attempts < gates.attemptsThreshold) {
      return { status: "skipped", reason: "Insufficient attempts", attempts };
    }
  }

  // Build the context payload now (cheap), but DON'T persist it or flip the
  // orchestrator pointer to ACTIVE until the Bland send actually succeeds.
  // Persisting before the send left a phantom smsFlowContext + an ACTIVE
  // pointer when sendSms threw (Bland down / non-2xx / auth) — the system
  // looked like an SMS was queued when none went out. Both writes now live in
  // the success branch after sendSms returns.
  const contextData = {
    domain,
    campaignId: (rawData.campaign as string) ?? "unknown",
    reservationId: resIdString,
    ...lead,
    firstName: guest.GuestFullName || "Guest",
    lastName: guest.SpouseName || guest.SpouseFullName || "",
    phone,
    timestamp: Date.now(),
  };

  // A/B variant
  const variant = await getAndToggleVariant(client);
  const blandPhone = phone.length === 10 ? `+1${phone}` : `+${phone}`;

  // History
  let historyContext = "No previous conversations.";
  let msgCount = 0;
  try {
    const history = await conversations.getHistoryContext(phone);
    historyContext = history.contextString;
    msgCount = history.count;
  } catch (e) {
    console.warn(`[trigger] history fetch failed: ${(e as Error).message}`);
  }

  // Atomic check-and-reserve immediately before the send. The early gate-4
  // (line ~230) is a cheap fail-fast read; this is the authoritative
  // mutual-exclusion step. Two concurrent requests for the same phone both
  // passed the gate, but only ONE wins this transaction — the loser stands
  // down instead of firing a duplicate SMS. (Override skips it, same as the
  // gate.) Reserving BEFORE the send means a same-window retry can't slip in
  // during the Bland round trip.
  if (!isOverride) {
    const reserved = await rateLimitCheckAndReserve(phone);
    if (!reserved) {
      return { status: "skipped", reason: "Rate Limited" };
    }
    // Atomically claim a global-daily-cap slot. This is the race-free
    // counterpart to the read-only gate-2 check above: read-and-increment
    // happens inside one transaction, so concurrent requests can't all read a
    // sub-cap count and collectively overshoot. If the cap is now reached,
    // release the rate-limit reservation we just took (no SMS will go out) and
    // skip.
    const slot = await reserveGlobalDailySlot(client, globalDailyCap);
    if (!slot) {
      await rateLimitRelease(phone);
      console.log(`[trigger] ⛔ daily cap reached at reserve — skipped`);
      return { status: "skipped", reason: "Global Daily Limit Reached" };
    }
  } else {
    // Override bypasses the gate but still records the send so back-to-back
    // QA triggers don't read each other as "never sent".
    await rateLimitReserve(phone);
  }

  const env = loadEnv();
  try {
    console.log(
      `[trigger] sending Bland SMS to ${blandPhone} via pathway ${env.blandPathwayId}/${env.blandPathwayVersion}`,
    );
    // NOTE: do NOT pass agent_message — omitting it tells the Bland pathway
    // to generate the opener itself. Hits /v1/sms/send (the endpoint that
    // actually fires the message), not /v1/sms/conversations (which only
    // initializes state).
    const blandResult = await bland.sendSms({
      user_number: blandPhone,
      agent_number: BLAND_AGENT_NUMBER,
      pathway_id: env.blandPathwayId,
      pathway_version: env.blandPathwayVersion,
      new_conversation: true,
      request_data: {
        EmailAddress: guest.EmailAddress || "",
        GuestFullNameFormula: guest.GuestFullName || "",
        guestName: guest.GuestFullName,
        guestPhone: blandPhone,
        ReservationCustomerFirstName: guest.GuestFullName?.split(" ")[0] ||
          guest.GuestFullName,
        reservationId: resIdString,
        variant,
        destination: lead.destination ||
          (rawData.desiredDestination1 as string) || "",
        MostRecentPackageIdDateOfBooking:
          guest.MostRecentPackageIdDateOfBooking,
        MostRecentPackageIdCreditCardType:
          guest.MostRecentPackageIdCreditCardType,
        MostRecentPackageIdLast4OfCreditCardOnly:
          guest.MostRecentPackageIdLast4OfCreditCardOnly,
        conversationHistory: historyContext,
        previousMessageCount: msgCount,
        agentLogin: (rawData.agentLogin as string) ?? "API",
        gatewayTag: (rawData.gatewayTag as string) ?? "Readymode",
      },
    });

    // Bland accepted the send — NOW it's safe to persist the flow context and
    // flip the pointer to ACTIVE. Doing this only on success means a Bland
    // failure (handled in the catch below) leaves no phantom "SMS was sent"
    // state behind.
    //
    // These metadata writes live in their OWN try-catch, NOT the Bland
    // try-catch: the SMS has already gone out, so a Firestore failure here must
    // never flip the return to "Bland API Failed" (which would make an upstream
    // retry resend the SMS) nor release the rate-limit/cap reservations for a
    // phone we just messaged. Treat them as fire-and-forget with a warning,
    // exactly like recordOutboundRecipientMarkers below.
    try {
      await client.set(smsFlowContextDocPath(phone), contextData);
      await orchestrator.updatePointer(phone, {
        originalSource: {
          domain,
          campaignId: (rawData.campaign as string) ?? "unknown",
          timestamp: Date.now(),
        },
        status: "ACTIVE",
      });
    } catch (e) {
      console.warn(
        `[trigger] ⚠️ post-send metadata write failed (SMS already sent, non-fatal): ${
          (e as Error).message
        }`,
      );
    }

    const conversationId =
      (blandResult.json as { data?: { conversation_id?: string } } | null)
        ?.data?.conversation_id;
    console.log(
      `[trigger] Bland response status=200 conversation_id=${
        conversationId ?? "(none)"
      }`,
    );
    if (conversationId) {
      // Fire-and-forget — fetch the agent's first message a few seconds later
      // and store it in conversations so dashboards have something to render.
      storeInitialBlandMessage(phone, conversationId).catch(() => {});
    }

    // NOTE: both the global-daily-cap slot and the per-phone rate-limit
    // reservation were already claimed atomically BEFORE the send
    // (reserveGlobalDailySlot + rateLimitCheckAndReserve), so we don't
    // increment/reserve again here. On the override path neither was claimed,
    // so bump the global counter to keep the daily total honest.
    if (isOverride) await incrementGlobalDailyCount(client);
    // Fire-and-forget write-side index for the nightly report's
    // "unique recipients" metric. Two idempotent atomicCreates so
    // repeat sends to the same phone short-circuit; failure here must
    // never block the SMS path, so we swallow rejections.
    recordOutboundRecipientMarkers(client, phone).catch((e) => {
      console.warn(
        `[trigger] recipient-marker write failed (non-fatal): ${
          (e as Error).message
        }`,
      );
    });

    return { status: "success", variant };
  } catch (e) {
    console.error(`[trigger] Bland API failed: ${(e as Error).message}`);
    // The SMS never went out, so roll back the pre-send reservations —
    // otherwise a transient Bland failure would lock this phone out of the
    // funnel for the full window AND permanently consume a global-cap slot.
    // (No smsFlowContext / ACTIVE pointer were written on this path — they're
    // now only persisted after sendSms succeeds — so there's nothing else to
    // roll back.)
    if (!isOverride) {
      await rateLimitRelease(phone);
      await releaseGlobalDailySlot(client);
    }
    return { status: "error", message: "Bland API Failed" };
  }
}

// Write the lifetime + per-week recipient marker docs. atomicCreate is
// idempotent — repeat sends to the same phone leave the lifetime doc as
// it was and only do one wasted read. See firestore-safety.md (Part B
// follow-up: nightly report no longer scans the conversations collection
// to compute unique-recipient counts).
//
// Also bumps the daily and lifetime textsSent counters — `+1` per send,
// not "+1 per unique recipient". The unique-recipient counts are derived
// from the marker collections (one doc per phone), so we keep textsSent
// as a separate raw-send total for "how many SMSes did we actually fire
// today" surfaces. FieldValue.increment is atomic, so concurrent sends
// can't lose updates here.
async function recordOutboundRecipientMarkers(
  client: FirestoreClient,
  phone: string,
): Promise<void> {
  const nowIsoStr = new Date().toISOString();
  const weekKey = easternMondayDateString();
  const today = easternDateString();
  // Unique-recipient markers are idempotent and independent of the counter —
  // keep them out of the counter-failure flag so a marker blip doesn't demote
  // the textsSent stat (and vice-versa).
  await Promise.all([
    client.atomicCreate(uniqueRecipientByPhoneDocPath(phone), {
      phone,
      firstSentAt: nowIsoStr,
    }),
    client.atomicCreate(
      weeklyRecipientByPhoneWeekDocPath(weekKey, phone),
      { phone, weekKey, firstSentAt: nowIsoStr },
    ),
  ]);
  // textsSent counter writes. Mirror the apptsBooked/activations
  // *CounterFailedAt observability pattern: on a quota/network blip the daily
  // textsSent increment can fail while the day looks like a real zero-texts
  // day. Stamp a per-day flag so the nightly report can mark the count as
  // unreliable instead of emailing a 0 that was never incremented; clear the
  // flag on a clean write.
  // Clear-on-success / stamp-on-failure of the per-day textsSentCounterFailedAt
  // flag is centralized in withCounterFailureFlag; it re-throws so the
  // fire-and-forget caller still logs the aggregator failure.
  await withCounterFailureFlag(
    client,
    metricsDailyDocPath(today),
    "textsSentCounterFailedAt",
    () =>
      Promise.all([
        client.incrementField(metricsDailyDocPath(today), { textsSent: 1 }),
        client.setMerge(metricsDailyDocPath(today), { updatedAt: nowIsoStr }),
        client.incrementField(metricsLifetimeDocPath(), { textsSent: 1 }),
        client.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIsoStr }),
      ]).then(() => {}),
  );
}

// Exported for tests — the textsSent counter-failure observability (the
// textsSentCounterFailedAt flag) is covered directly rather than only via the
// full Bland-dependent trigger flow.
export const _recordOutboundRecipientMarkersForTest =
  recordOutboundRecipientMarkers;

async function storeInitialBlandMessage(
  phone: string,
  conversationId: string,
): Promise<void> {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const r = await bland.getConversation(conversationId);
    const messages = r.json.data?.messages ?? [];
    const first = messages.find((m) => m.sender === "AGENT");
    if (first) {
      await conversations.storeMessage(
        phone,
        conversationId,
        "AI Bot",
        first.message,
      );
    }
  } catch (e) {
    console.warn(
      `[trigger] storeInitialBlandMessage failed: ${(e as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Inject / Scrub / DNC HTTP calls into ReadyMode TPI/lead-api endpoints
// ---------------------------------------------------------------------------

function buildLeadUrl(
  baseUrl: string,
  lead: Record<string, unknown>,
  domain: DialerDomain,
): string {
  const params = new URLSearchParams();
  const append = (field: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    params.append(`lead[0][${field}]`, String(value));
  };

  // Normalize the injected phone to the same 10-digit form scrubLead targets,
  // so a later scrub addresses the exact record we created. Fall back to the
  // raw value only when normalizePhone can't parse it (better to inject with
  // the caller's string than drop the phone entirely and create a useless
  // lead).
  const rawPhone = (lead.phone as string) || (lead.primaryPhone as string);
  append("phone", normalizePhone(rawPhone) ?? rawPhone);

  // RM's lead-api REJECTS the entire lead if it sees a field name it doesn't
  // recognize (HTTP 200 + {"Accepted":false,"Error":"Field not recognized"}).
  // "notes" is a normalized name — RM wants the domain's custom field
  // (Custom_52 on ODR/ACT, Custom_21 on Monster). Translate it; everything else
  // is passed through (callers already use RM field names for those).
  // NO fallback to a hardcoded field: an unmapped domain that defaulted to a
  // guessed field (e.g. Custom_21) would get the whole lead rejected — the very
  // bug this exists to kill — so a missing mapping drops the note instead.
  const notesField = leadFieldFor(domain, "notes");
  for (const [k, v] of Object.entries(lead)) {
    if (k === "phone" || k === "primaryPhone") continue;
    if (k === "notes") {
      if (!notesField) {
        console.warn(
          `[inject] no notes-field mapping for ${domain} — dropping notes`,
        );
        continue;
      }
      // Explicit domain field (e.g. Custom_52) already present with a real
      // value → it wins; don't also emit the translated `notes` and
      // double-send the field. Gate on the VALUE, not key existence: a lead
      // carrying `{ notes: "real", Custom_52: undefined|"" }` must still emit
      // the real note (append() already drops ""/null/undefined, so an empty
      // explicit field correctly yields to the translated note).
      if (lead[notesField]) continue;
      append(notesField, v);
      continue;
    }
    append(k, v);
  }

  // Default note when the caller supplied none — under the domain's field.
  if (notesField && !lead.notes && !lead[notesField]) {
    append(
      notesField,
      `Scheduled Call Added at: ${
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "numeric",
          day: "numeric",
          year: "2-digit",
          hour: "numeric",
          minute: "2-digit",
        }).replace(",", "")
      }`,
    );
  }

  return `${baseUrl}/?${params.toString()}`;
}

// Exported for tests — the URL wiring is the actual fix site (notes → the
// domain's RM field), so it's covered directly rather than only via leadFieldFor.
export const _buildLeadUrlForTest = buildLeadUrl;

// RM's lead-api returns HTTP 200 even when it REJECTS the lead — an unrecognized
// field name comes back as
// {"0":{"Success":false,"Accepted":false,"Error":"Field not recognized"}}.
// Trusting res.ok alone recorded these never-created leads as "injected" (the
// scheduled-appointment sweep then logged "✅ fired"). Detect the explicit
// rejection so a 200 is never mistaken for a created lead.
export function injectBodyExplicitlyRejected(
  text: string,
  json: unknown,
): boolean {
  const row = (json as Record<string, Record<string, unknown>> | null)?.["0"];
  if (row?.Accepted === false || row?.Success === false) return true;
  // Text fallback for when JSON.parse failed or the shape differs. Whitespace-
  // tolerant so "Accepted":false / "Accepted" : false / newlines all match.
  // Symmetric with the JSON path above (which checks BOTH Accepted:false AND
  // Success:false): a malformed body carrying only "Success":false — no
  // Accepted field — is still an explicit rejection, so never let it slip
  // through as a phantom inject.
  return /"Accepted"\s*:\s*false|"Success"\s*:\s*false/.test(text);
}

// Does the raw RM body assert Success:true? Whitespace-tolerant text fallback
// for when JSON.parse failed or the shape differs (mirrors the regex tolerance
// in injectBodyExplicitlyRejected).
function bodyAssertsSuccessTrue(text: string): boolean {
  return /"Success"\s*:\s*true/.test(text);
}

// The authoritative "was the lead actually created" verdict, combining the
// positive Success:true signal with the explicit-rejection guard. RM returns
// HTTP 200 even on rejection AND can return a contradictory
// {"Success":true,"Accepted":false}, so a lead counts as injected ONLY when it
// asserts success AND is not explicitly rejected. Pure + exported so the verdict
// combo is unit-tested without a fetch mock.
export function injectVerdictIsSuccess(
  isSuccess: boolean,
  explicitlyRejected: boolean,
): boolean {
  return isSuccess && !explicitlyRejected;
}

export async function injectLead(
  lead: ReadymodeLeadDto,
  domain: DialerDomain,
  campaignId?: string,
  overrideChannel?: string,
): Promise<ReadymodeResponseDto> {
  if (lead.reservationId && !lead.firstName) {
    try {
      const guest = await findGuestByResId(Number(lead.reservationId));
      if (guest) {
        lead.firstName = guest.GuestFullName || lead.firstName;
        lead.lastName = guest.SpouseName || guest.SpouseFullName || "";
      }
    } catch (e) {
      console.warn(`[inject] CRM refresh failed: ${(e as Error).message}`);
    }
  }

  const config = DOMAIN_CONFIG[domain];
  const targetId = campaignId || overrideChannel || config.channels.addLead;
  const baseUrl = `${config.baseUrl}/lead-api/${targetId}`;

  // Preemptive scrub (replaces the legacy injection-lock; do NOT reintroduce a lock).
  // Log the outcome so a silent scrub-then-fail-to-inject sequence is visible:
  // without this, a failed re-add leaves the lead vanished from ReadyMode and we
  // had no record of which step dropped it.
  try {
    const scrubbed = await scrubLead(lead.phone, domain);
    console.log(
      `[inject] ${
        scrubbed ? "✅" : "⚠️"
      } preemptive scrub ${domain} phone=${lead.phone} → ${
        scrubbed ? "ok" : "no-op/fail"
      }`,
    );
  } catch (e) {
    console.warn(
      `[inject] ⚠️ preemptive scrub threw ${domain} phone=${lead.phone}: ${
        (e as Error).message
      } (non-fatal)`,
    );
  }

  const url = buildLeadUrl(
    baseUrl,
    lead as unknown as Record<string, unknown>,
    domain,
  );
  console.log(
    `[inject] 🚀 ${domain} phone=${lead.phone} target=${targetId} → ${
      url.slice(0, 200)
    }`,
  );

  try {
    const res = await fetch(url, { method: "POST" });
    const text = await res.text();
    const bodySlice = text.slice(0, 300).replace(/\s+/g, " ");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch { /* ignore */ }

    // The authoritative "was the lead actually created" verdict. RM returns
    // HTTP 200 even on rejection, so every branch below consults this — a
    // 200-but-Accepted:false is never recorded as a phantom inject.
    const explicitlyRejected = injectBodyExplicitlyRejected(text, json);

    const isSuccess =
      ((json as Record<string, unknown> | null)?.Success === true) ||
      ((json as Record<string, Record<string, unknown>> | null)?.["0"]
        ?.Success === true) ||
      text.includes('"Success":true') ||
      text.includes('"Success": true');
    const isDuplicate = !isSuccess && (
      text.includes("Duplicate") || text.includes("leadId") ||
      !!((json as Record<string, unknown> | null)?.xencall_leadId)
    );

    let success = false;
    let outcome = "";
    if (isSuccess) {
      // isSuccess already requires Success:true (mutually exclusive with a
      // rejection), but gate on the verdict too so a contradictory body can
      // never slip through as a phantom success.
      success = injectVerdictIsSuccess(isSuccess, explicitlyRejected);
      outcome = `${
        success ? "ok" : "rejected"
      } http=${res.status} body="${bodySlice}"`;
      console.log(
        `[inject] ${
          success ? "✅" : "❌"
        } ${domain} phone=${lead.phone} target=${targetId} → ${outcome}`,
      );
    } else if (isDuplicate) {
      console.log(
        `[inject] 🔁 ${domain} phone=${lead.phone} target=${targetId} → duplicate detected http=${res.status} body="${bodySlice}"`,
      );
      const retry = await handleDuplicate(lead, domain, text, url);
      success = retry.status === "success";
      outcome = `${
        success ? "ok" : "failed"
      } via duplicate-retry (${retry.message})`;
      console.log(
        `[inject] ${
          success ? "✅" : "❌"
        } ${domain} phone=${lead.phone} target=${targetId} → ${outcome}`,
      );
    } else {
      // Honor the body's explicit verdict over res.ok — the safety net that
      // surfaces a rejected lead instead of recording a phantom inject.
      success = res.ok && !explicitlyRejected;
      outcome = `${
        explicitlyRejected ? "rejected" : success ? "ok" : "failed"
      } http=${res.status} body="${bodySlice}"`;
      console.log(
        `[inject] ${
          success ? "⚠️" : "❌"
        } ${domain} phone=${lead.phone} target=${targetId} → ${outcome}`,
      );
    }

    if (success) {
      // The lead is already created in RM — these are post-inject AUDIT writes
      // (event log + pointer). They live in their OWN try-catch, NOT the outer
      // fetch try-catch (whose catch re-throws as "Injection Failed"): a
      // Firestore failure here must never make injectLead throw, because callers
      // (return-to-source.ts, bland-talk-now.ts) don't wrap injectLead and rely
      // on result.status — a thrown error would crash their handlers and, in
      // talk-now, misreport a real inject as failed. Mirrors the non-fatal
      // post-send metadata pattern in processInboundLead.
      try {
        await orchestrator.logEvent(lead.phone, {
          action: "INJECT",
          domain,
          campaignId: campaignId ?? "API",
          details: `Injected to ${domain}`,
        });
        await orchestrator.updatePointer(lead.phone, {
          currentLocation: {
            domain,
            campaignId: campaignId ?? "API",
            timestamp: Date.now(),
          },
          status: domain === DialerDomain.ODR ? "IN_ODR" : "ACTIVE",
        });
      } catch (e) {
        console.warn(
          `[inject] ⚠️ ${domain} phone=${lead.phone} post-inject metadata write failed (lead already injected, non-fatal): ${
            (e as Error).message
          }`,
        );
      }
      return { status: "success", message: "Injected" };
    }

    return {
      status: "error",
      message: `Injection Failed: http=${res.status} ${bodySlice}`,
    };
  } catch (e) {
    console.error(
      `[inject] ❌ ${domain} phone=${lead.phone} target=${targetId} → threw: ${
        (e as Error).message
      }`,
    );
    throw new Error(`Injection Failed: ${(e as Error).message}`);
  }
}

async function handleDuplicate(
  lead: ReadymodeLeadDto,
  domain: DialerDomain,
  errorBody: string,
  originalUrl: string,
): Promise<ReadymodeResponseDto> {
  let leadId: string | undefined;
  const textMatch = errorBody.match(/Lead ID XC:([\d]+)/);
  if (textMatch?.[1]) leadId = textMatch[1];
  if (!leadId) {
    const jsonMatch = errorBody.match(/"xencall_leadId":\s*"XC:([\d]+)"/);
    if (jsonMatch?.[1]) leadId = jsonMatch[1];
  }
  if (!leadId) {
    console.warn(
      `[inject] ⚠️ duplicate-handler ${domain} phone=${lead.phone} → could not parse leadId from body="${
        errorBody.slice(0, 200).replace(/\s+/g, " ")
      }"`,
    );
    return { status: "error", message: "Duplicate - ID Parse Failed" };
  }

  const scrubbed = await scrubLead(lead.phone, domain, leadId);
  if (!scrubbed) {
    console.warn(
      `[inject] ⚠️ duplicate-handler ${domain} phone=${lead.phone} leadId=${leadId} → scrub returned false`,
    );
    return { status: "error", message: "Scrub Failed" };
  }

  const ts = Date.now().toString();
  const newUrl = originalUrl
    .replace(/lead%5B0%5D/g, `lead%5B${ts}%5D`)
    .replace(/lead\[0\]/g, `lead[${ts}]`);

  const retryRes = await rateLimitSchedule(() =>
    fetch(newUrl, { method: "POST" })
  );
  const retryText = await retryRes.text();
  const retryBody = retryText.slice(0, 300).replace(/\s+/g, " ");
  // Apply the SAME explicit verdict the main flow uses — a loose
  // includes("Success") matched {"Success":false} / {"Accepted":false} and
  // recorded RM rejections as phantom injects. RM returns HTTP 200 on
  // rejection, so trust the body's verdict, not the substring.
  let retryJson: unknown = null;
  try {
    retryJson = JSON.parse(retryText);
  } catch { /* ignore */ }
  const retrySuccess = injectVerdictIsSuccess(
    bodyAssertsSuccessTrue(retryText) ||
      ((retryJson as Record<string, unknown> | null)?.Success === true) ||
      ((retryJson as Record<string, Record<string, unknown>> | null)?.["0"]
        ?.Success === true),
    injectBodyExplicitlyRejected(retryText, retryJson),
  );
  if (retrySuccess) {
    console.log(
      `[inject] ✅ duplicate-handler ${domain} phone=${lead.phone} leadId=${leadId} → retry ok http=${retryRes.status}`,
    );
    return { status: "success", message: "Injected after Scrub" };
  }
  console.warn(
    `[inject] ❌ duplicate-handler ${domain} phone=${lead.phone} leadId=${leadId} → retry failed http=${retryRes.status} body="${retryBody}"`,
  );
  return {
    status: "error",
    message: `Retry Failed: http=${retryRes.status} ${retryBody}`,
  };
}

export async function scrubLead(
  phone: string,
  domain: DialerDomain,
  leadId?: string,
): Promise<boolean> {
  const config = DOMAIN_CONFIG[domain];
  const url = `${config.baseUrl}/${config.channels.scrubLead}`;
  const { user, pass } = getRmCreds(domain);

  const params = new URLSearchParams();
  params.append("API_user", user);
  params.append("API_pass", pass);
  // Normalize+VALIDATE via normalizePhone (not a blind slice(-10)). A blind
  // slice would turn an 11+ digit lead (e.g. an override-path lead RM stored
  // as-is) into a DIFFERENT 10-digit number and scrub the wrong record,
  // leaving the real duplicate in RM to re-trigger phantom "Duplicate"
  // handling. normalizePhone returns null on anything that isn't a real
  // 10-digit US number, so we never scrub by a guessed phone.
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  // Bail ONLY when there's no usable identifier at all. When the phone is
  // unparseable but a leadId was supplied (handleDuplicate passes BOTH), degrade
  // to scrub-by-leadId instead of failing the whole cleanup — bailing here is
  // what surfaced "Scrub Failed" in the duplicate-handler retry flow even though
  // the leadId scrub would have succeeded.
  if (!normalizedPhone && !leadId) {
    if (phone) {
      console.warn(
        `[scrub] ⚠️ ${domain} unparseable phone="${phone}" and no leadId — skipping scrub`,
      );
    }
    return false;
  }
  if (normalizedPhone) params.append("lead[phone]", normalizedPhone);
  else if (phone) {
    console.warn(
      `[scrub] ⚠️ ${domain} unparseable phone="${phone}" — scrubbing by leadId=${leadId} only`,
    );
  }
  if (leadId) params.append("lead[leadId]", leadId);
  params.append("result", "false");

  try {
    const res = await rateLimitSchedule(() =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      })
    );
    const text = await res.text();
    const bodySlice = text.slice(0, 200).replace(/\s+/g, " ");
    // Explicit verdict, NOT a loose substring. `text.includes("Success")`
    // matched {"Success":false} too, and res.ok is true for any HTTP 200 —
    // which RM returns on rejection. Require an affirmative Success:true and
    // no explicit rejection, so a failed scrub never logs a phantom SCRUB
    // event (the same verdict pattern injectLead applies).
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch { /* ignore */ }
    const success = injectVerdictIsSuccess(
      bodyAssertsSuccessTrue(text) ||
        ((json as Record<string, unknown> | null)?.Success === true) ||
        ((json as Record<string, Record<string, unknown>> | null)?.["0"]
          ?.Success === true),
      injectBodyExplicitlyRejected(text, json),
    );
    if (success) {
      await orchestrator.logEvent(phone, {
        action: "SCRUB",
        domain,
        details: "Scrubbed from campaign",
      });
    } else {
      console.warn(
        `[scrub] ⚠️ ${domain} phone=${phone}${
          leadId ? ` leadId=${leadId}` : ""
        } → http=${res.status} body="${bodySlice}"`,
      );
    }
    return success;
  } catch (e) {
    console.error(
      `[scrub] ❌ ${domain} phone=${phone}${
        leadId ? ` leadId=${leadId}` : ""
      } threw: ${(e as Error).message}`,
    );
    return false;
  }
}

async function dncLead(
  phone: string,
  domain: DialerDomain,
  reason = "API Request",
): Promise<boolean> {
  const config = DOMAIN_CONFIG[domain];
  const url = `${config.baseUrl}/${config.channels.dnc}`;
  const { user, pass } = getRmCreds(domain);

  const params = new URLSearchParams();
  params.append("API_user", user);
  params.append("API_pass", pass);
  params.append("entry[phone]", phone);
  params.append("entry[reason]", reason);

  try {
    const res = await rateLimitSchedule(() =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      })
    );
    // Strict verdict, NOT `includes("Success") || res.ok`. The loose substring
    // matched {"Success":false}, and res.ok is true for any HTTP 200 — which RM
    // returns even on rejection. So a rejected DNC was reported as success and
    // dncGlobal recorded the domain as 'Success' while the lead stayed in active
    // campaigns. Require an affirmative Success:true with no explicit rejection
    // (same verdict pattern scrubLead/injectLead use).
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch { /* ignore */ }
    return injectVerdictIsSuccess(
      bodyAssertsSuccessTrue(text) ||
        ((json as Record<string, unknown> | null)?.Success === true) ||
        ((json as Record<string, Record<string, unknown>> | null)?.["0"]
          ?.Success === true),
      injectBodyExplicitlyRejected(text, json),
    );
  } catch {
    return false;
  }
}

export async function dncGlobal(
  phone: string,
): Promise<Record<string, string>> {
  if (phone === "0") return {};
  const results: Record<string, string> = {};
  for (const domain of Object.values(DialerDomain)) {
    try {
      results[domain] = (await dncLead(phone, domain)) ? "Success" : "Failed";
    } catch {
      results[domain] = "Error";
    }
  }
  return results;
}

// Used by the StandardLead → per-domain payload conversion when callers want
// a typed surface to the mapping module.
export const denormalizeLead = denormalize;
export type { StandardLead };
