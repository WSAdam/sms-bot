// One-shot backfill: build the sms-bot/uniqueguestsbyphone aggregator
// from existing conversations messages. Required because the new
// /api/guests/list reads ONLY the aggregator — historical phones with no
// future inbound message would otherwise be invisible.
//
// Idempotent: each phone's aggregator is computed from scratch and
// `set` unconditionally, so re-runs converge to the same state.
//
// Sequencing: deploy the new storeMessage aggregator-write AND the new
// guests/list handler together; run this backfill at the same time so
// the aggregator is populated before the new endpoint serves traffic.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//   deno run -A --env-file=env/local scripts/backfill-unique-guests.ts \
//     [--dry-run] [--limit=N]

import { parseArgs } from "@std/cli/parse-args";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  uniqueGuestByPhoneDocPath,
} from "@shared/firestore/paths.ts";
import { type BatchOp, getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const args = parseArgs(Deno.args, {
  boolean: ["dry-run"],
  string: ["limit"],
  default: { limit: "200000" },
});

const limit = Number(args.limit);
if (!Number.isFinite(limit) || limit <= 0) {
  console.error(`❌ Invalid --limit=${args.limit}`);
  Deno.exit(1);
}

const dryRun = !!args["dry-run"];
const db = getFirestoreClient();

console.log(
  `🚀 backfill-unique-guests: scanning ${conversationsCollection} limit=${limit} dryRun=${dryRun}`,
);

const all = await db.list(conversationsCollection, { limit });
console.log(`🔍 fetched ${all.length} messages`);

const deduped = dedupeMessages(
  all
    .map((e) => e.data as unknown as ConversationMessage)
    .filter((m) => m.phoneNumber && !isExcludedFromReporting(m.phoneNumber)),
);
console.log(`📊 ${deduped.length} after dedupe`);

interface Agg {
  phoneNumber: string;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
  replyCount: number;
  hasReplied: boolean;
}
const aggMap = new Map<string, Agg>();

for (const m of deduped) {
  const phone = m.phoneNumber;
  const ts = m.timestamp ?? "";
  let cur = aggMap.get(phone);
  if (!cur) {
    cur = {
      phoneNumber: phone,
      firstSeen: ts,
      lastSeen: ts,
      messageCount: 0,
      replyCount: 0,
      hasReplied: false,
    };
    aggMap.set(phone, cur);
  }
  cur.messageCount++;
  if (m.sender === "Guest") {
    cur.replyCount++;
    cur.hasReplied = true;
  }
  if (ts && ts < cur.firstSeen) cur.firstSeen = ts;
  if (ts && ts > cur.lastSeen) cur.lastSeen = ts;
}

console.log(`📊 unique phones: ${aggMap.size}`);

if (dryRun) {
  const sample = Array.from(aggMap.values()).slice(0, 5);
  console.log(`📋 [dry-run] sample:`, sample);
  Deno.exit(0);
}

const updatedAt = new Date().toISOString();
const writes: BatchOp[] = [];
for (const a of aggMap.values()) {
  writes.push({
    type: "set",
    path: uniqueGuestByPhoneDocPath(a.phoneNumber),
    data: { ...a, updatedAt },
  });
}

console.log(`💾 committing ${writes.length} aggregator docs...`);
await db.batch(writes);
console.log(`✅ done — phones=${writes.length}`);
