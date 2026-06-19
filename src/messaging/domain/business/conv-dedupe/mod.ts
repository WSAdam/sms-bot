// Collapse (callId, sender, message) duplicates to the earliest-timestamp doc.
// Pre-dedupe (storeMessage's 5-min window shipped Apr 30 2026) Bland's pathway
// fired the conversation webhook twice per round — once at the inbound node,
// once at the transitioned-to node — producing thousands of duplicate writes
// historically. Dashboard endpoints apply this in-memory dedupe to keep counts
// honest until a one-shot cleanup script removes them from Firestore.

import type { ConversationMessage } from "@shared/types/conversation.ts";

export function dedupeMessages(
  messages: ConversationMessage[],
): ConversationMessage[] {
  const map = new Map<string, ConversationMessage>();
  for (const m of messages) {
    if (!m.callId || !m.sender || m.message == null) {
      // Malformed — skip the dedupe key entirely so it still shows up.
      map.set(`__raw_${map.size}`, m);
      continue;
    }
    const key = `${m.callId}__${m.sender}__${m.message}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, m);
      continue;
    }
    // Keep earliest by ISO-string lex compare (works for ISO timestamps).
    if ((m.timestamp ?? "") < (existing.timestamp ?? "")) {
      map.set(key, m);
    }
  }
  return Array.from(map.values());
}
