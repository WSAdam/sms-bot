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
  const existing = await client.get(path);
  const newCount = (typeof existing?.count === "number" ? existing.count : 0) + 1;
  await client.set(path, { count: newCount, updatedAt: new Date().toISOString() });
  return newCount;
}
