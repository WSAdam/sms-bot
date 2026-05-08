// Re-seed Firestore conversations from Bland's API for a date range.
// Used by both the nightly cron and the manual /api/conversations/reseed
// endpoint. Parallelizes Bland fetches in batches of 4 so a typical day's
// volume completes well under Deno Deploy's cron tick limit.
//
// Safety: if Bland returns FEWER messages than we have stored for a given
// callId, we leave existing docs alone — Bland may age conversations out
// of their API and we'd nuke the only copy.

import * as bland from "@shared/services/bland/client.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import {
  type BatchOp,
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
  const all = await getFirestoreClient().list(conversationsCollection, {
    limit: 50_000,
  });
  const matching = all.filter((e) => {
    if (!e.id.startsWith(`${phone10}__${callId}__`)) return false;
    return true;
  });
  return { count: matching.length, docIds: matching.map((e) => e.id) };
}

async function reseedOne(
  phone10: string,
  callId: string,
): Promise<{ status: "reseeded" | "skipped" | "error"; delta: number; reason?: string }> {
  const r = await bland.getConversation(callId);
  if (!r.ok || !r.json.data) {
    return {
      status: "error",
      delta: 0,
      reason: `Bland ${r.status}: ${JSON.stringify(r.json.errors ?? r.json).slice(0, 120)}`,
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
    `[reseed] Bland returned ${list.conversations.length} conversations for ${fromIso} → ${toIso ?? "now"}`,
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
  const toIso =
    new Date(new Date(fromIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { fromIso, toIso };
}
