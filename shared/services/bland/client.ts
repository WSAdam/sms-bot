// Bland.ai SMS client. Thin wrappers over fetch — every method takes a
// fully-formed payload and returns the parsed JSON.

import { BLAND_API_BASE } from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";
import {
  normalizeAppointmentTime,
  parseBlandDesiredTimeMs,
} from "@shared/util/time.ts";

interface BlandHeaders {
  [key: string]: string;
}

function authHeader(): BlandHeaders {
  const env = loadEnv();
  const key = env.blandApiKey || env.blandFallbackApiKey;
  if (!key) throw new Error("Missing BLAND_API_KEY (or NU_BLAND_API_KEY)");
  return { authorization: key };
}

// SMS send — POSTs to https://api.bland.ai/v1/sms/send.
//
// Two callers:
//   1. /trigger/test-sms QA endpoint — passes `agent_message` verbatim,
//      bypassing any pathway, so we can preview specific text on a real
//      phone without authoring a Bland pathway.
//   2. processInboundLead — passes `pathway_id` + `pathway_version` and
//      OMITS `agent_message`, which tells the Bland pathway to generate
//      the opener itself. (Per Bland docs, /v1/sms/conversations only
//      initializes state without sending — /v1/sms/send is the endpoint
//      that actually fires the first message.)
export interface SendSmsParams {
  user_number: string;     // E.164 destination
  agent_number: string;    // E.164 sender (must be a number on your Bland account)
  agent_message?: string;  // raw message text — omit when using a pathway
  pathway_id?: string;
  pathway_version?: string;
  new_conversation?: boolean;
  request_data?: Record<string, unknown>;
}

export async function sendSms(
  params: SendSmsParams,
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const url = BLAND_API_BASE.replace(/\/conversations$/, "/send");
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const status = res.status;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch { /* non-JSON body — leave json null, we'll surface text in error */ }

  console.log(`[bland] POST ${url} → ${status}`);
  if (!res.ok) {
    console.error(`[bland] non-2xx body:`, json ?? text);
    throw new Error(`Bland sendSms ${status}: ${text.slice(0, 200)}`);
  }
  return { status, ok: res.ok, json };
}

export interface BlandConvoResponse {
  data?: {
    user_number?: string;
    message_count?: number;
    created_at?: string;
    messages?: Array<{ sender: string; message: string; created_at?: string }>;
    // Bland's pathway request variables. `Desired_Time` is the canonical
    // appointment time the bot parsed and locked in — far more reliable
    // than re-parsing English from the message stream.
    variables?: Record<string, unknown>;
  };
  errors?: unknown;
}

// 4h past tolerance covers talk-now and "call me in 30 min" cases plus
// DST off-by-one. 180d future cap accepts vacation bookings months out
// while rejecting stale upstream values (we've seen leads come in with a
// 2-year-old Desired_Time inherited from their source record).
const DESIRED_TIME_PAST_TOLERANCE_MS = 4 * 60 * 60 * 1000;
const DESIRED_TIME_MAX_FUTURE_MS = 180 * 24 * 60 * 60 * 1000;

// Best-effort: fetches the conversation, reads `variables.Desired_Time`,
// sanity-checks it against `variables.now_utc`, and returns the parsed
// ISO string + ms. Returns null on any failure (no network, no variable,
// stale/bogus value). Callers should treat this as a fallback signal,
// not the primary appt time source.
export async function getBlandDesiredTime(
  callId: string,
): Promise<{ iso: string; ms: number; source: string } | null> {
  try {
    const r = await getConversation(callId);
    // deno-lint-ignore no-explicit-any
    const d: any = (r.json as any)?.data;
    const v = d?.variables ?? {};
    const dt = typeof v.Desired_Time === "string" ? v.Desired_Time : "";
    if (!dt) return null;
    const tz = typeof v.timezone === "string" ? v.timezone : undefined;
    const desiredMs = parseBlandDesiredTimeMs(dt, tz);
    if (desiredMs == null) return null;
    const nowIso = typeof v.now_utc === "string" ? v.now_utc : d?.created_at;
    const nowMs = nowIso ? new Date(nowIso).getTime() : NaN;
    if (!Number.isFinite(nowMs)) return null;
    if (desiredMs < nowMs - DESIRED_TIME_PAST_TOLERANCE_MS) return null;
    if (desiredMs > nowMs + DESIRED_TIME_MAX_FUTURE_MS) return null;
    // Normalize at the source so every downstream caller (booking-scan,
    // recovery scripts, manual triggers) gets canonical UTC. Bland's
    // raw `Desired_Time` is sometimes TZ-naive (e.g. "2026-06-14T07:30:00"
    // with no Z or offset) which JS would interpret as UTC and fire ~4h
    // early in EDT. normalizeAppointmentTime interprets naive strings as
    // the customer's local wall-clock using Bland's `variables.timezone`.
    return {
      iso: normalizeAppointmentTime(dt, tz),
      ms: desiredMs,
      source: `bland.variables.Desired_Time (tz=${tz ?? "?"})`,
    };
  } catch (e) {
    console.warn(
      `[bland] getBlandDesiredTime(${callId}) failed: ${(e as Error).message}`,
    );
    return null;
  }
}

export async function getConversation(
  conversationId: string,
): Promise<{ status: number; ok: boolean; json: BlandConvoResponse }> {
  const res = await fetch(`${BLAND_API_BASE}/${conversationId}`, {
    headers: authHeader(),
  });
  const json = await res.json();
  return { status: res.status, ok: res.ok, json };
}

export interface BlandListItem {
  id: string;
  user_number: string;
  message_count: number;
  created_at: string;
}

export async function listConversationsToday(): Promise<
  { from: string; conversations: BlandListItem[] }
> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const r = await listConversationsByDateRange(todayStart.toISOString());
  return { from: todayStart.toISOString(), conversations: r.conversations };
}

// Page through Bland's conversations API for a custom date range. Used by
// the nightly conversation reseed cron — pulls every conversation Bland
// saw in the window so we can re-fetch its messages and overwrite our
// (potentially out-of-date) Firestore copy.
//
// IMPORTANT: Bland's `page` param is BROKEN — pages 2/3/N return the same
// rows as page 1. Their `extra.pagination` block is also missing entirely
// from the response. We paginate via a CURSOR on `created_at` instead:
// shrink the upper bound to just before the earliest row of each page.
const BLAND_PAGE_SIZE = 100;
const BLAND_CURSOR_MAX_PAGES = 200; // safety cap → 20k convos

export async function listConversationsByDateRange(
  fromIso: string,
  toIso?: string,
): Promise<{ from: string; to: string | null; conversations: BlandListItem[] }> {
  const conversations = await cursorPaginate([
    { field: "created_at", operator: "gte", value: fromIso },
    ...(toIso ? [{ field: "created_at", operator: "lte", value: toIso }] : []),
  ], toIso ?? null);
  return { from: fromIso, to: toIso ?? null, conversations };
}

// Search Bland for every conversation that ever existed for a single phone.
// Used by the auto-pull recovery path: when sale-match writes a record with
// `withinDays < 0` (sale recorded BEFORE the appointment), the originating
// Bland conversation is almost certainly older than yesterday's reseed
// window — fetch it directly so the dashboard's phone-link search works.
//
// `user_number contains <phone10>` is the filter that actually works
// (eq/= return 400 — Bland's parser rejects exact matches on this field).
export async function searchConversationsByPhone(
  phone10: string,
): Promise<BlandListItem[]> {
  if (!/^\d{10}$/.test(phone10)) {
    throw new Error(`searchConversationsByPhone: invalid phone "${phone10}"`);
  }
  return await cursorPaginate([
    { field: "user_number", operator: "contains", value: phone10 },
  ], null);
}

// Shared cursor-pagination helper. Fetches up to BLAND_PAGE_SIZE rows,
// then narrows the upper-bound to (earliest row's created_at - 1ms) and
// repeats. Stops when a page returns < BLAND_PAGE_SIZE rows or when we
// hit the safety cap.
async function cursorPaginate(
  baseFilters: Array<Record<string, unknown>>,
  initialUpperIso: string | null,
): Promise<BlandListItem[]> {
  const all: BlandListItem[] = [];
  let upperIso: string | null = initialUpperIso;
  for (let i = 0; i < BLAND_CURSOR_MAX_PAGES; i++) {
    const filters: Array<Record<string, unknown>> = [...baseFilters];
    // Replace any existing created_at lte with our cursor bound.
    if (upperIso) {
      const idx = filters.findIndex((f) =>
        f.field === "created_at" && f.operator === "lte"
      );
      const entry = { field: "created_at", operator: "lte", value: upperIso };
      if (idx >= 0) filters[idx] = entry;
      else filters.push(entry);
    }
    const url = new URL(BLAND_API_BASE);
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", String(BLAND_PAGE_SIZE));
    url.searchParams.set("sortBy", "created_at");
    url.searchParams.set("sortDir", "desc");
    url.searchParams.set("filters", JSON.stringify(filters));
    const res = await fetch(url.toString(), { headers: authHeader() });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `Bland list ${res.status}: ${
          JSON.stringify(json?.errors ?? json).slice(0, 200)
        }`,
      );
    }
    const data: BlandListItem[] = json?.data ?? [];
    if (data.length === 0) break;
    for (const c of data) all.push(c);
    if (data.length < BLAND_PAGE_SIZE) break;
    const earliest = data[data.length - 1].created_at;
    if (!earliest) break;
    upperIso = new Date(new Date(earliest).getTime() - 1).toISOString();
  }
  return all;
}
