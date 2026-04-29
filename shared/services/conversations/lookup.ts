// Secondary index: callId → phone. Lives at sms-bot/conversations/byCallId/{callId}.

import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type { CallIdLookup } from "@shared/types/conversation.ts";

export const lookupCollection = `${ROOT_COLLECTION}/conversations/byCallId`;

export function lookupDocPath(callId: string): string {
  return `${lookupCollection}/${callId}`;
}

export async function getPhoneByCallId(
  rawCallId: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<string | null> {
  const callId = (() => {
    try {
      return decodeURIComponent(rawCallId);
    } catch {
      return rawCallId;
    }
  })();
  const r = await client.get(lookupDocPath(callId)) as CallIdLookup | null;
  return r?.phone ?? null;
}
