// Global daily SMS counter (Eastern Time). Stored under
// sms-bot/globalsmscount/byDate/{YYYY-MM-DD}.
//
// PILOT (shape-checker migration Phase 0): still imports infra via @shared/*.
// Those become @core/* once the core kernel is migrated — kept as-is for now so
// this first pass tests only the canonical *structure*, not the import rules.

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
  // required. Pre-fix this was a read-then-write that lost increments under
  // concurrent /trigger/readymode webhooks, letting the daily cap be exceeded.
  await client.incrementField(path, { count: 1 });
  await client.setMerge(path, { updatedAt: new Date().toISOString() });
  const after = await client.get(path);
  return typeof after?.count === "number" ? after.count : 0;
}
