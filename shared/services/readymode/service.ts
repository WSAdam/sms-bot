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
} from "@shared/firestore/wrapper.ts";
import { getAndToggleVariant } from "@shared/services/ab-test/service.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import * as bland from "@shared/services/bland/client.ts";
import * as conversations from "@shared/services/conversations/store.ts";
import { findGuestByResId } from "@shared/services/crm/reservations.ts";
import { isDnc } from "@shared/services/dnc/service.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import {
  checkOnly as rateLimitCheck,
  reserve as rateLimitReserve,
  schedule as rateLimitSchedule,
} from "@shared/services/rate-limiter/service.ts";
import { getRmCreds } from "@shared/services/readymode/auth.ts";
import { DOMAIN_CONFIG } from "@shared/services/readymode/config.ts";
import { fetchAttemptsFromTpi } from "@shared/services/readymode/tpi-client.ts";
import { denormalize, normalize } from "@shared/services/readymode/mapping.ts";
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
  const today = easternDateString();
  const path = globalSmsCountDocPath(today);
  await client.incrementField(path, { count: 1 });
  await client.setMerge(path, { updatedAt: new Date().toISOString() });
}

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
  if (!isOverride) {
    const envCap = loadEnv().globalDailySmsCap;
    const cap = envCap !== GLOBAL_DAILY_SMS_CAP
      ? envCap
      : gates.globalDailySmsCap;
    const dailyCount = await getGlobalDailyCount(client);
    if (dailyCount >= cap) {
      console.log(
        `[trigger] ⛔ daily cap reached: ${dailyCount}/${cap} — skipped`,
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

  // Save context
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
  await client.set(smsFlowContextDocPath(phone), contextData);

  // Orchestrator pointer
  await orchestrator.updatePointer(phone, {
    originalSource: {
      domain,
      campaignId: (rawData.campaign as string) ?? "unknown",
      timestamp: Date.now(),
    },
    status: "ACTIVE",
  });

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

    await incrementGlobalDailyCount(client);
    await rateLimitReserve(phone);
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
  await Promise.all([
    client.atomicCreate(uniqueRecipientByPhoneDocPath(phone), {
      phone,
      firstSentAt: nowIsoStr,
    }),
    client.atomicCreate(
      weeklyRecipientByPhoneWeekDocPath(weekKey, phone),
      { phone, weekKey, firstSentAt: nowIsoStr },
    ),
    client.incrementField(metricsDailyDocPath(today), { textsSent: 1 }),
    client.setMerge(metricsDailyDocPath(today), { updatedAt: nowIsoStr }),
    client.incrementField(metricsLifetimeDocPath(), { textsSent: 1 }),
    client.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIsoStr }),
  ]);
}

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
): string {
  const params = new URLSearchParams();
  const append = (field: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    params.append(`lead[0][${field}]`, String(value));
  };

  append("phone", (lead.phone as string) || (lead.primaryPhone as string));

  for (const [k, v] of Object.entries(lead)) {
    if (k === "phone" || k === "primaryPhone") continue;
    append(k, v);
  }

  if (!lead.Custom_21 && !lead.notes) {
    append(
      "Custom_21",
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

  const url = buildLeadUrl(baseUrl, lead as unknown as Record<string, unknown>);
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
      success = true;
      outcome = `ok http=${res.status}`;
      console.log(
        `[inject] ✅ ${domain} phone=${lead.phone} target=${targetId} → ${outcome}`,
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
      success = res.ok;
      outcome = `${
        success ? "ok" : "failed"
      } http=${res.status} body="${bodySlice}"`;
      console.log(
        `[inject] ${
          success ? "⚠️" : "❌"
        } ${domain} phone=${lead.phone} target=${targetId} → ${outcome}`,
      );
    }

    if (success) {
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
  if (
    retryText.includes("Success") || retryText.includes("success") ||
    retryText.includes('"Success": true')
  ) {
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
  if (phone) params.append("lead[phone]", phone.replace(/\D/g, "").slice(-10));
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
    const success = text.includes("Success") || res.ok;
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
    return (await res.text()).includes("Success") || res.ok;
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
