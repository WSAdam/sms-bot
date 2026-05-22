// Global daily SMS counter (Eastern Time). Stored under
// sms-bot/globalsmscount/byDate/{YYYY-MM-DD}.

import { globalSmsCountDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";

export async function getCount(
  date: string = easternDateString(),
  client: FirestoreClient = getFirestoreClient(),
): Promise<number> {
  const r = await client.get(globalSmsCountDocPath(date));
  return typeof r?.count === "number" ? r.count : 0;
}

export async function increment(
  date: string = easternDateString(),
  client: FirestoreClient = getFirestoreClient(),
): Promise<number> {
  const path = globalSmsCountDocPath(date);
  // FieldValue.increment is atomic on Firestore's side — no transaction
  // required. Pre-fix this was a read-then-write that lost increments
  // under concurrent /trigger/readymode webhooks, letting the daily cap
  // be exceeded by however many lost updates.
  await client.incrementField(path, { count: 1 });
  await client.setMerge(path, { updatedAt: new Date().toISOString() });
  // Re-read for the return value. Callers that only need the new count
  // for logging tolerate the small race between the increment and read
  // (a concurrent increment might bump the value above what we just
  // added) — the atomicity guarantee of the increment is what matters
  // for the daily cap enforcement upstream.
  const after = await client.get(path);
  return typeof after?.count === "number" ? after.count : 0;
}
