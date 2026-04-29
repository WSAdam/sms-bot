// Main SMS pipeline orchestrator. Ports
// _source-omnisource/sms-flow/readymode/service/mod.ts to plain Deno.
//
// Strips NestJS decorators, replaces node:http(s) with fetch, fails fast on
// missing RM creds (no `adam`/`Winter123` defaults), reads BLAND_PATHWAY_VERSION
// from env so we can flip off "production" without a code change.

import {
  ATTEMPTS_GATEKEEPER_THRESHOLD,
  BLAND_AGENT_NUMBER,
  GLOBAL_DAILY_SMS_CAP,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";
import {
  globalSmsCountDocPath,
  leadPointerDocPath,
  smsFlowContextDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { getAndToggleVariant } from "@shared/services/ab-test/service.ts";
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
import {
  denormalize,
  normalize,
} from "@shared/services/readymode/mapping.ts";
import {
  DialerDomain,
  type ReadymodeLeadDto,
  type ReadymodeResponseDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import { easternDateString } from "@shared/util/time.ts";

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
      console.warn(`[trigger] Unknown dialerDomain '${input}', defaulting to MONSTER`);
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
): Promise<number> {
  const today = easternDateString();
  const path = globalSmsCountDocPath(today);
  const existing = await client.get(path);
  const newCount = (typeof existing?.count === "number" ? existing.count : 0) + 1;
  await client.set(path, { count: newCount, updatedAt: new Date().toISOString() });
  return newCount;
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
  console.log(`[trigger] 📥 incoming: ${JSON.stringify(rawData).slice(0, 600)}`);

  const domain = resolveDomain(
    (rawData.dialerDomain as string) ?? (rawData.domain as string),
  );
  const lead = normalize(domain, rawData);
  const phone = lead.phone ||
    (rawData.primaryPhone ? String(rawData.primaryPhone).replace(/\D/g, "") : "");
  const resIdString = lead.reservationId ||
    String(rawData.resID ?? rawData.Custom_56 ?? "");
  const attempts = Number(rawData.attempts ?? rawData.times_called ?? 0);

  if (!phone) {
    return { status: "error", message: "Missing phone number" };
  }

  const isOverride = String(rawData.override).toLowerCase() === "true" ||
    rawData.override === true;
  if (isOverride) {
    console.log("[trigger] 🚨 OVERRIDE bypassing all gatekeepers");
  }

  // Gatekeeper 1: attempts
  if (!isOverride && attempts < ATTEMPTS_GATEKEEPER_THRESHOLD) {
    return { status: "skipped", reason: "Insufficient attempts", attempts };
  }

  // Gatekeeper 2: global daily cap
  if (!isOverride) {
    const dailyCount = await getGlobalDailyCount(client);
    if (dailyCount >= GLOBAL_DAILY_SMS_CAP) {
      return { status: "skipped", reason: "Global Daily Limit Reached" };
    }
  }

  // CRM enrichment
  const guest = await findGuestByResId(Number(resIdString));
  if (!guest) {
    console.warn(`[trigger] guest not found for ResID ${resIdString} — skipping`);
    return { status: "skipped", reason: "Guest Not Found" };
  }
  if (guest.Dnc) {
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
    const blandResult = await bland.createConversation({
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
        MostRecentPackageIdDateOfBooking: guest.MostRecentPackageIdDateOfBooking,
        MostRecentPackageIdCreditCardType: guest.MostRecentPackageIdCreditCardType,
        MostRecentPackageIdLast4OfCreditCardOnly:
          guest.MostRecentPackageIdLast4OfCreditCardOnly,
        conversationHistory: historyContext,
        previousMessageCount: msgCount,
        agentLogin: (rawData.agentLogin as string) ?? "API",
        gatewayTag: (rawData.gatewayTag as string) ?? "Readymode",
      },
    });

    const conversationId = blandResult?.data?.conversation_id;
    if (conversationId) {
      // Fire-and-forget — fetch the agent's first message a few seconds later
      // and store it in conversations so dashboards have something to render.
      storeInitialBlandMessage(phone, conversationId).catch(() => {});
    }

    await incrementGlobalDailyCount(client);
    await rateLimitReserve(phone);

    return { status: "success", variant };
  } catch (e) {
    console.error(`[trigger] Bland API failed: ${(e as Error).message}`);
    return { status: "error", message: "Bland API Failed" };
  }
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
      await conversations.storeMessage(phone, conversationId, "AI Bot", first.message);
    }
  } catch (e) {
    console.warn(`[trigger] storeInitialBlandMessage failed: ${(e as Error).message}`);
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
  try {
    await scrubLead(lead.phone, domain);
  } catch (e) {
    console.warn(`[inject] preemptive scrub failed (non-fatal): ${(e as Error).message}`);
  }

  const url = buildLeadUrl(baseUrl, lead as unknown as Record<string, unknown>);
  console.log(`[inject] 🚀 ${domain} target=${targetId} → ${url.slice(0, 200)}`);

  try {
    const res = await fetch(url, { method: "POST" });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch { /* ignore */ }

    let success = false;
    if (
      ((json as Record<string, unknown> | null)?.Success === true) ||
      ((json as Record<string, Record<string, unknown>> | null)?.["0"]?.Success === true) ||
      text.includes('"Success":true') ||
      text.includes('"Success": true')
    ) {
      success = true;
    } else if (
      text.includes("Duplicate") || text.includes("leadId") ||
      ((json as Record<string, unknown> | null)?.xencall_leadId)
    ) {
      const retry = await handleDuplicate(lead, domain, text, url);
      success = retry.status === "success";
    } else {
      success = res.ok;
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

    return { status: "error", message: `Injection Failed: ${text.slice(0, 200)}` };
  } catch (e) {
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
  if (!leadId) return { status: "error", message: "Duplicate - ID Parse Failed" };

  if (!(await scrubLead(lead.phone, domain, leadId))) {
    return { status: "error", message: "Scrub Failed" };
  }

  const ts = Date.now().toString();
  const newUrl = originalUrl
    .replace(/lead%5B0%5D/g, `lead%5B${ts}%5D`)
    .replace(/lead\[0\]/g, `lead[${ts}]`);

  const retryRes = await rateLimitSchedule(() => fetch(newUrl, { method: "POST" }));
  const retryText = await retryRes.text();
  if (
    retryText.includes("Success") || retryText.includes("success") ||
    retryText.includes('"Success": true')
  ) {
    return { status: "success", message: "Injected after Scrub" };
  }
  return { status: "error", message: "Retry Failed" };
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
    const success = text.includes("Success") || res.ok;
    if (success) {
      await orchestrator.logEvent(phone, {
        action: "SCRUB",
        domain,
        details: "Scrubbed from campaign",
      });
    }
    return success;
  } catch (e) {
    console.error(`[scrub] ${domain} failed: ${(e as Error).message}`);
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
  params.append("entry[reason] ", reason);

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

export async function dncGlobal(phone: string): Promise<Record<string, string>> {
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
