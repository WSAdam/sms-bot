// Conversation message store. Writes BOTH the message AND the
// callId→phone secondary lookup index — the lookup write happens FIRST so
// getConversationByCallId never races with the message write (gotcha §15).

import {
  conversationDocPath,
  conversationsCollection,
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
  return msg;
}

export async function getAllConversations(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<ConversationMessage[]> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  const all = await client.list(conversationsCollection, { limit: 500 });
  return all
    .filter((e) => e.id.startsWith(`${phone}__`))
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
  const all = await client.list(conversationsCollection, { limit: 1000 });
  const toDelete = all.filter((e) => e.id.startsWith(`${phone}__`));
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
  const all = await client.list(conversationsCollection, { limit: 500 });
  const toDelete = all.filter((e) => e.id.startsWith(`${phone}__${callId}__`));
  await client.batch(
    toDelete.map((e) => ({
      type: "delete" as const,
      path: conversationDocPath(e.id),
    })),
  );
  return toDelete.length;
}
