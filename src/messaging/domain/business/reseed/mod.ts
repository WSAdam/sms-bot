// Re-seed Firestore conversations from Bland's API for a date range.
// Used by both the nightly cron and the manual /api/conversations/reseed
// endpoint. Parallelizes Bland fetches in batches of 4 so a typical day's
// volume completes well under Deno Deploy's cron tick limit.
//
// Safety: if Bland returns FEWER messages than we have stored for a given
// callId, we leave existing docs alone — Bland may age conversations out
// of their API and we'd nuke the only copy.

import * as bland from "@messaging/domain/data/bland/mod.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";

const PARALLEL = 4;

export interface ReseedSummary {
  fromIso: string;
  toIso: string | null;
  blandConversations: number;
  reseeded: number;
  skippedFewer: number;
  skippedNoCallId: number;
  errored: number;
  netMessagesAdded: number;
  errors: string[];
}

interface BlandMsg {
  sender?: string;
  message?: string;
  created_at?: string;
}

async function getCurrentMessagesForCall(
  phone10: string,
  callId: string,
): Promise<{ count: number; docIds: string[] }> {
  // Filter at the database via callId — auto-indexed single-field, same
  // path storeMessage's dedupe uses. Pre-fix this scanned the entire
  // conversations collection (50k limit) per Bland conversation, which
  // during the nightly reseed multiplied into N × full-table scans. See
  // firestore-safety.md.
  const matches = await getFirestoreClient().list(conversationsCollection, {
    where: { field: "callId", op: "==", value: callId },
  });
  // Cross-check phoneNumber as a safety belt: callId is globally unique
  // in practice but we don't want a hypothetical collision to silently
  // delete another phone's history during reseed.
  const matching = matches.filter((e) => {
    const m = e.data as { phoneNumber?: string };
    return m.phoneNumber === phone10;
  });
  return { count: matching.length, docIds: matching.map((e) => e.id) };
}

async function reseedOne(
  phone10: string,
  callId: string,
): Promise<
  { status: "reseeded" | "skipped" | "error"; delta: number; reason?: string }
> {
  const r = await bland.getConversation(callId);
  if (!r.ok || !r.json.data) {
    return {
      status: "error",
      delta: 0,
      reason: `Bland ${r.status}: ${
        JSON.stringify(r.json.errors ?? r.json).slice(0, 120)
      }`,
    };
  }
  const blandMsgs = (r.json.data.messages ?? []).filter((m: BlandMsg) =>
    m.message && m.message !== "<Call Connected>"
  );
  const current = await getCurrentMessagesForCall(phone10, callId);
  if (blandMsgs.length <= current.count) {
    return { status: "skipped", delta: 0, reason: "no improvement" };
  }
  const ops: BatchOp[] = current.docIds.map((id) => ({
    type: "delete" as const,
    path: `${conversationsCollection}/${id}`,
  }));
  for (const m of blandMsgs as BlandMsg[]) {
    const ts = m.created_at ?? new Date().toISOString();
    const sender = m.sender === "USER" ? "Guest" : "AI Bot";
    ops.push({
      type: "set",
      path: `${conversationsCollection}/${phone10}__${callId}__${ts}`,
      data: {
        phoneNumber: phone10,
        callId,
        sender,
        message: m.message,
        timestamp: ts,
      },
    });
  }
  await getFirestoreClient().batch(ops);
  return { status: "reseeded", delta: blandMsgs.length - current.count };
}

export async function reseedConversationsByDateRange(
  fromIso: string,
  toIso?: string,
): Promise<ReseedSummary> {
  const list = await bland.listConversationsByDateRange(fromIso, toIso);
  const summary: ReseedSummary = {
    fromIso,
    toIso: toIso ?? null,
    blandConversations: list.conversations.length,
    reseeded: 0,
    skippedFewer: 0,
    skippedNoCallId: 0,
    errored: 0,
    netMessagesAdded: 0,
    errors: [],
  };
  console.log(
    `[reseed] Bland returned ${list.conversations.length} conversations for ${fromIso} → ${
      toIso ?? "now"
    }`,
  );

  // Process in parallel batches so Bland fetches overlap.
  const items = list.conversations;
  for (let i = 0; i < items.length; i += PARALLEL) {
    const chunk = items.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map(async (c) => {
      const phone = String(c.user_number ?? "").replace(/\D/g, "");
      const phone10 = phone.length >= 10 ? phone.slice(-10) : phone;
      const callId = c.id;
      if (!phone10 || phone10.length !== 10 || !callId) {
        return { status: "no-callId" as const };
      }
      try {
        const r = await reseedOne(phone10, callId);
        return { status: r.status, delta: r.delta, reason: r.reason };
      } catch (e) {
        return {
          status: "error" as const,
          delta: 0,
          reason: (e as Error).message,
        };
      }
    }));
    for (const r of results) {
      if (r.status === "reseeded") {
        summary.reseeded++;
        summary.netMessagesAdded += r.delta ?? 0;
      } else if (r.status === "skipped") {
        summary.skippedFewer++;
      } else if (r.status === "no-callId") {
        summary.skippedNoCallId++;
      } else {
        summary.errored++;
        if (r.reason) summary.errors.push(r.reason);
      }
    }
  }
  console.log(
    `[reseed] done — reseeded=${summary.reseeded} skipped=${summary.skippedFewer} errored=${summary.errored} delta=+${summary.netMessagesAdded}`,
  );
  return summary;
}

// Pull EVERY conversation Bland has for a single phone, then reseed each
// one. Used by the auto-recovery path triggered when sale-match writes a
// record with `withinDays < 0` — the originating Bland conversation is
// almost certainly older than the nightly reseed's 1-day window.
//
// Returns counts so the caller can log/respond meaningfully. Errors per
// conversation are collected but never thrown — partial recovery is
// preferable to no recovery.
export interface PerPhonePullSummary {
  phone10: string;
  blandConversations: number;
  reseeded: number;
  skippedFewer: number;
  errored: number;
  netMessagesAdded: number;
  errors: string[];
}

export async function reseedConversationsForPhone(
  phone10: string,
): Promise<PerPhonePullSummary> {
  const conversations = await bland.searchConversationsByPhone(phone10);
  const summary: PerPhonePullSummary = {
    phone10,
    blandConversations: conversations.length,
    reseeded: 0,
    skippedFewer: 0,
    errored: 0,
    netMessagesAdded: 0,
    errors: [],
  };
  console.log(
    `[reseed-by-phone] ${phone10}: Bland returned ${conversations.length} conversations`,
  );
  for (let i = 0; i < conversations.length; i += PARALLEL) {
    const chunk = conversations.slice(i, i + PARALLEL);
    const results = await Promise.all(
      chunk.map(async (c) => {
        const phone = String(c.user_number ?? "").replace(/\D/g, "");
        const p10 = phone.length >= 10 ? phone.slice(-10) : phone;
        // Sanity: Bland's `contains` filter is fuzzy; reject any row where
        // the matched user_number doesn't actually end in our phone10.
        if (p10 !== phone10) return { status: "fuzzy-mismatch" as const };
        try {
          return await reseedOne(phone10, c.id);
        } catch (e) {
          return {
            status: "error" as const,
            delta: 0,
            reason: (e as Error).message,
          };
        }
      }),
    );
    for (const r of results) {
      if (r.status === "reseeded") {
        summary.reseeded++;
        summary.netMessagesAdded += r.delta ?? 0;
      } else if (r.status === "skipped") {
        summary.skippedFewer++;
      } else if (r.status === "error") {
        summary.errored++;
        if (r.reason) summary.errors.push(r.reason);
      }
    }
  }
  console.log(
    `[reseed-by-phone] ${phone10}: reseeded=${summary.reseeded} skipped=${summary.skippedFewer} errored=${summary.errored} delta=+${summary.netMessagesAdded}`,
  );
  return summary;
}

// Convenience: re-seed YESTERDAY in Eastern Time. Used by the nightly cron.
export function yesterdayEasternRange(): { fromIso: string; toIso: string } {
  // Build yesterday's start/end in ET, expressed as UTC for Bland's filter.
  const now = new Date();
  // Convert "now" to ET to figure out today's date, then subtract 1.
  const etDateString = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD
  const [y, m, d] = etDateString.split("-").map((s) => parseInt(s, 10));
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yy = yesterday.getUTCFullYear();
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getUTCDate()).padStart(2, "0");
  // Yesterday 00:00 ET → UTC; yesterday 23:59:59 ET → UTC. ET offset is
  // -04:00 in EDT, -05:00 in EST. Use a wide window (UTC offset -05) and a
  // hard upper bound 24h later — we slightly over-fetch but never miss.
  const fromIso = `${yy}-${mm}-${dd}T05:00:00.000Z`;
  const toIso = new Date(new Date(fromIso).getTime() + 24 * 60 * 60 * 1000)
    .toISOString();
  return { fromIso, toIso };
}

// ---------------------------------------------------------------------------
// On-booking transcript ingestion (PURELY ADDITIVE — never deletes).
//
// Called best-effort after a successful inject on the direct-injection booking
// paths (/sms-callback/bland/talk-now, /cal/schedule) so the Bland transcript
// lands in `conversations` immediately, instead of waiting for the nightly
// reseed (which talk-now never reaches — it only writes the inject signal).
//
// Unlike reseedOne, this NEVER deletes: it only `set`s each Bland message at
// the deterministic id `phone10__callId__created_at` (same scheme reseedOne
// uses, so it's idempotent across runs and de-duplicates against
// webhook/reseed-stored copies via the read-time dedupeMessages). That
// preserves the cal/schedule "appointment scheduled" marker and any operator
// nodeTags that a delete-replace would strip. See context.md §0.21.
// ---------------------------------------------------------------------------

// cal/schedule is a PUBLIC webhook, so a caller-supplied conversationId flows
// into getConversation's URL (`${BLAND_API_BASE}/${id}`). Restrict it to a
// plain id token so it can't traverse to another Bland endpoint or inject
// query params. The same guard rejects junk ids returned by the phone search.
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
// The doc-id timestamp must be a real ISO-8601 datetime: keeps docs sortable
// AND rejects Firestore-illegal ids ("." / ".." / anything with "/").
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// Bound the work a single (public, unauthenticated) booking webhook can drive.
// SMS conversations are tiny — these limits are generous, not operational.
const MAX_CONVERSATIONS = 12;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_MESSAGE_LEN = 8000; // SMS bodies are ≤1600; blocks oversized abuse.
const BATCH_CHUNK = 400; // Firestore batch op cap is 500 — stay safely under.

export interface IngestTranscriptSummary {
  phone10: string;
  conversations: number;
  stored: number;
  skipped: number;
  errored: number;
  errors: string[];
}

export interface IngestTranscriptDeps {
  getConversation: typeof bland.getConversation;
  searchConversationsByPhone: typeof bland.searchConversationsByPhone;
  client: FirestoreClient;
}

// Validate + map one Bland message to an additive conversation BatchOp, or null
// to skip it (placeholder/empty/oversized body, or a non-ISO timestamp we can't
// key safely/sortably). The doc id carries the per-message `idx` so two lines
// sharing a `created_at` (same-second, or both `.000Z`) don't collide on one id
// and silently drop one — read-time dedupeMessages keys on content, not id, so
// it never recovers a storage-level overwrite. Stable across re-pulls when
// Bland returns messages in the same order; if the order shifts, re-ingest
// writes new ids that dedupeMessages (callId+sender+message) then collapses.
function buildMsgOp(
  m: BlandMsg,
  phone10: string,
  cid: string,
  idx: number,
): BatchOp | null {
  const text = m?.message;
  const ts = m?.created_at;
  if (
    typeof text !== "string" || !text || text === "<Call Connected>" ||
    text.length > MAX_MESSAGE_LEN
  ) {
    return null;
  }
  if (typeof ts !== "string" || !ISO_TIMESTAMP.test(ts)) return null;
  // Mirror the per-call webhook's mapping exactly (USER|GUEST → Guest) so an
  // ingest copy and a webhook copy of the same line share a dedupe key.
  const su = String(m.sender ?? "").toUpperCase();
  const sender = su === "USER" || su === "GUEST" ? "Guest" : "AI Bot";
  return {
    type: "set",
    path: `${conversationsCollection}/${phone10}__${cid}__${ts}__${idx}`,
    data: {
      phoneNumber: phone10,
      callId: cid,
      sender,
      message: text,
      timestamp: ts,
    },
  };
}

export async function ingestBlandTranscript(
  phone10: string,
  conversationId?: string,
  deps?: Partial<IngestTranscriptDeps>,
): Promise<IngestTranscriptSummary> {
  const getConversation = deps?.getConversation ?? bland.getConversation;
  const searchByPhone = deps?.searchConversationsByPhone ??
    bland.searchConversationsByPhone;
  const client = deps?.client ?? getFirestoreClient();

  const summary: IngestTranscriptSummary = {
    phone10,
    conversations: 0,
    stored: 0,
    skipped: 0,
    errored: 0,
    errors: [],
  };

  if (!/^\d{10}$/.test(phone10)) {
    summary.errors.push(`invalid phone "${phone10}"`);
    summary.errored++;
    return summary;
  }

  // Resolve the Bland conversation ids to pull — a vetted single id when the
  // webhook carries one, else every conversation Bland has for this phone.
  let convIds: string[] = [];
  try {
    if (conversationId && SAFE_CONVERSATION_ID.test(conversationId)) {
      convIds = [conversationId];
    } else {
      if (conversationId) {
        console.warn(
          `[ingest] ${phone10}: ignoring unsafe conversationId, using phone search`,
        );
      }
      const list = await searchByPhone(phone10);
      convIds = (Array.isArray(list) ? list : [])
        .filter((c) => {
          const digits = String(c?.user_number ?? "").replace(/\D/g, "");
          const p10 = digits.length >= 10 ? digits.slice(-10) : digits;
          return p10 === phone10; // Bland's `contains` filter is fuzzy.
        })
        .map((c) => c?.id)
        .filter((id): id is string =>
          typeof id === "string" && SAFE_CONVERSATION_ID.test(id)
        );
    }
  } catch (e) {
    summary.errored++;
    summary.errors.push(`resolve: ${(e as Error).message}`);
    return summary;
  }

  if (convIds.length > MAX_CONVERSATIONS) {
    summary.errors.push(
      `capped: ${convIds.length} conversations → ${MAX_CONVERSATIONS}`,
    );
    convIds = convIds.slice(0, MAX_CONVERSATIONS);
  }
  summary.conversations = convIds.length;

  for (const cid of convIds) {
    try {
      const r = await getConversation(cid);
      if (!r?.ok || !r.json?.data) {
        summary.errored++;
        summary.errors.push(
          `${cid}: Bland ${r?.status}: ${
            JSON.stringify(r?.json?.errors ?? r?.json ?? {}).slice(0, 100)
          }`,
        );
        continue;
      }
      const allMsgs = Array.isArray(r.json.data.messages)
        ? r.json.data.messages as BlandMsg[]
        : [];
      if (allMsgs.length > MAX_MESSAGES_PER_CONVERSATION) {
        summary.skipped += allMsgs.length - MAX_MESSAGES_PER_CONVERSATION;
      }
      const ops: BatchOp[] = [];
      allMsgs.slice(0, MAX_MESSAGES_PER_CONVERSATION).forEach((m, idx) => {
        const op = buildMsgOp(m, phone10, cid, idx);
        if (op) ops.push(op);
        else summary.skipped++;
      });
      for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
        await client.batch(ops.slice(i, i + BATCH_CHUNK));
      }
      summary.stored += ops.length;
    } catch (e) {
      summary.errored++;
      summary.errors.push(`${cid}: ${(e as Error).message}`);
    }
  }

  console.log(
    `[ingest] ${phone10}: conversations=${summary.conversations} stored=${summary.stored} skipped=${summary.skipped} errored=${summary.errored}`,
  );
  return summary;
}
