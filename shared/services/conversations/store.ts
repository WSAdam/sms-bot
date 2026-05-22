// Conversation message store. Writes BOTH the message AND the
// callId→phone secondary lookup index — the lookup write happens FIRST so
// getConversationByCallId never races with the message write (gotcha §15).
// Also updates the per-phone aggregator (uniqueguestsbyphone) so the
// dashboard's "Unique Guests Reached" drill-in can paginate cheaply
// instead of scanning the full conversations table — see firestore-safety.md.

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationDocPath,
  conversationsCollection,
  uniqueGuestByPhoneDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  CallIdLookup,
  ConversationMessage,
} from "@shared/types/conversation.ts";
import { conversationDocId } from "@shared/util/id.ts";
import { normalizePhone } from "@shared/util/phone.ts";
import { lookupDocPath } from "@shared/services/conversations/lookup.ts";

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Bland's pathway fires duplicate webhooks for the same logical message as
// the conversation transitions between nodes — typically within 60s of each
// other, sometimes with different nodeTags. 5 minutes is a comfortable
// window that catches every observed dupe without suppressing legit re-asks.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export async function storeMessage(
  rawPhone: string,
  rawCallId: string,
  sender: "Guest" | "AI Bot",
  message: string,
  nodeTag?: string,
  doNotText?: boolean,
  client: FirestoreClient = getFirestoreClient(),
): Promise<ConversationMessage> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  const callId = decode(rawCallId);
  const timestamp = new Date().toISOString();

  // Dedupe: short-circuit if an identical (callId, sender, message) write
  // landed in the last DEDUPE_WINDOW_MS. Match ignores nodeTag — first one
  // in keeps its tag, later dupes are dropped.
  //
  // We list by callId only (no orderBy) because Firestore would otherwise
  // require a composite (callId asc, timestamp desc) index — which it
  // refused without one and 500'd every webhook hit. Per callId there are
  // ≤ ~50 messages in practice, so filtering in-memory is cheap and avoids
  // the index management overhead.
  const matches = await client.list(conversationsCollection, {
    where: { field: "callId", op: "==", value: callId },
    limit: 500,
  });
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const dup = matches
    .map((e) => e.data as unknown as ConversationMessage)
    .find((m) =>
      m.sender === sender &&
      m.message === message &&
      new Date(m.timestamp).getTime() >= cutoff
    );
  if (dup) {
    console.log(
      `[storeMessage] dedupe: skip dup phone=${phone} callId=${callId} ` +
        `sender=${sender} (existing ts=${dup.timestamp})`,
    );
    return dup;
  }

  // 🔥 IMPORTANT: write the lookup FIRST so getConversationByCallId can
  // resolve phone-by-callId before any message is queried.
  const lookup: CallIdLookup = { phone };
  await client.set(
    lookupDocPath(callId),
    lookup as unknown as Record<string, unknown>,
  );

  const msg: ConversationMessage = {
    phoneNumber: phone,
    callId,
    timestamp,
    sender,
    message,
    ...(nodeTag ? { nodeTag } : {}),
    ...(doNotText ? { doNotText: true } : {}),
  };

  await client.set(
    conversationDocPath(conversationDocId(phone, callId, timestamp)),
    msg as unknown as Record<string, unknown>,
  );

  // Update the dashboard aggregator. Fire-and-forget so a write failure
  // here never breaks the message write — the aggregator can be rebuilt
  // any time by scripts/backfill-unique-guests.ts. Test phones are
  // excluded so they don't pollute the dashboard counts.
  if (!isExcludedFromReporting(phone)) {
    updateUniqueGuestAggregator(client, phone, sender, timestamp).catch((e) => {
      console.warn(
        `[storeMessage] aggregator write failed (non-fatal): ${
          (e as Error).message
        }`,
      );
    });
  }

  return msg;
}

interface UniqueGuestDoc {
  phoneNumber: string;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
  replyCount: number;
  hasReplied: boolean;
  updatedAt: string;
}

async function updateUniqueGuestAggregator(
  client: FirestoreClient,
  phone: string,
  sender: "Guest" | "AI Bot",
  timestamp: string,
): Promise<void> {
  // Transactional read-modify-write so concurrent storeMessage calls
  // for the same phone don't lose count increments. The aggregator doc
  // is small (handful of scalars) so the transaction round-trip is fast.
  const isGuest = sender === "Guest";
  await client.transactionalUpdate(
    uniqueGuestByPhoneDocPath(phone),
    (existing) => {
      const prev = existing as unknown as UniqueGuestDoc | null;
      const next: UniqueGuestDoc = {
        phoneNumber: phone,
        firstSeen: prev?.firstSeen ?? timestamp,
        lastSeen: prev && prev.lastSeen > timestamp ? prev.lastSeen : timestamp,
        messageCount: (prev?.messageCount ?? 0) + 1,
        replyCount: (prev?.replyCount ?? 0) + (isGuest ? 1 : 0),
        hasReplied: prev?.hasReplied || isGuest,
        updatedAt: new Date().toISOString(),
      };
      return next as unknown as Record<string, unknown>;
    },
  );
}

export async function getAllConversations(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<ConversationMessage[]> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  // Filter at the database with an indexed equality on phoneNumber instead
  // of listing the whole collection and filtering in memory. The previous
  // limit:50_000 form caused the 2026-05-19 Firestore quota-exceeded
  // incident — see firestore-safety.md.
  const matches = await client.list(conversationsCollection, {
    where: { field: "phoneNumber", op: "==", value: phone },
    limit: 1000,
  });
  return matches
    .map((e) => e.data as unknown as ConversationMessage)
    .sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
}

export async function checkIfOptedOut(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const messages = await getAllConversations(rawPhone, client);
  return messages.some((m) => m.doNotText === true);
}

export async function getHistoryContext(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<{ contextString: string; count: number }> {
  const messages = await getAllConversations(rawPhone, client);
  if (messages.length === 0) {
    return { contextString: "No previous conversations.", count: 0 };
  }
  const contextString = messages.map((msg) => {
    const date = new Date(msg.timestamp).toLocaleString();
    const tag = msg.nodeTag ? `[${msg.nodeTag}]` : "";
    return `[${date}] ${tag} ${msg.sender}: ${msg.message}`;
  }).join("\n");
  return { contextString, count: messages.length };
}

export async function deleteConversations(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<number> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  // Filter at the database — listing everything then prefix-matching can
  // silently miss messages once the collection grows beyond the limit
  // window (the legacy 500/1000 cap). See firestore-safety.md.
  const toDelete = await client.list(conversationsCollection, {
    where: { field: "phoneNumber", op: "==", value: phone },
  });
  await client.batch(
    toDelete.map((e) => ({
      type: "delete" as const,
      path: conversationDocPath(e.id),
    })),
  );
  return toDelete.length;
}

export async function deleteConversationsByCallId(
  rawPhone: string,
  callId: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<number> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  // Per-callId there are ≤ ~50 messages in practice, so filter on the
  // callId field (cheaper + already auto-indexed) and verify phoneNumber
  // client-side as a safety belt against a hypothetical cross-phone
  // collision.
  const matches = await client.list(conversationsCollection, {
    where: { field: "callId", op: "==", value: callId },
  });
  const toDelete = matches.filter((e) => {
    const m = e.data as { phoneNumber?: string };
    return m.phoneNumber === phone;
  });
  await client.batch(
    toDelete.map((e) => ({
      type: "delete" as const,
      path: conversationDocPath(e.id),
    })),
  );
  return toDelete.length;
}
