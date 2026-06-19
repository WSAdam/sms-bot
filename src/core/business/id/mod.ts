// Deterministic doc-ID builders. Used wherever a document key needs to be
// re-derivable from its contents (so re-runs overwrite instead of duplicating).

export function conversationDocId(
  phone10: string,
  callId: string,
  timestamp: string,
): string {
  return `${phone10}__${callId}__${timestamp}`;
}

export function injectionHistoryDocId(
  phone10: string,
  firedAt: string,
): string {
  return `${phone10}__${firedAt}`;
}

export function orchestratorEventDocId(
  phone10: string,
  eventTimestamp: string,
): string {
  return `${phone10}__${eventTimestamp}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
