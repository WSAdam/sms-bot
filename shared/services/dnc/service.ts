// DNC / opt-out flag. Stored at sms-bot/dnc/byPhone/{phone10}.

import { dncDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export async function markDnc(
  rawPhone: string,
  reason = "STOP",
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return;
  await client.set(dncDocPath(phone10), {
    phone10,
    doNotText: true,
    reason,
    markedAt: new Date().toISOString(),
  });
}

export async function isDnc(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return false;
  const r = await client.get(dncDocPath(phone10));
  return !!r?.doNotText;
}
