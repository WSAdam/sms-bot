// Per-phone SmsFlowContext storage. Stored at sms-bot/smsflowcontext/byPhone/{phone10}.

import { smsFlowContextDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type { SmsFlowContext } from "@shared/types/sms-flow-context.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export async function saveContext(
  rawPhone: string,
  context: Partial<SmsFlowContext>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  const path = smsFlowContextDocPath(phone);
  let existing: Partial<SmsFlowContext> = {};
  try {
    existing = (await client.get(path)) as Partial<SmsFlowContext> ?? {};
  } catch { /* ignore */ }
  await client.set(path, {
    ...existing,
    ...context,
    phone,
    timestamp: Date.now(),
  } as unknown as Record<string, unknown>);
}

export async function getContext(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<SmsFlowContext | null> {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  return await client.get(smsFlowContextDocPath(phone)) as SmsFlowContext | null;
}
