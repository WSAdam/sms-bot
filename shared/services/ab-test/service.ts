// A/B variant toggle. Stores a single global counter (0=A, 1=B) under
// abtest/byPhone/_global. Each call returns the current letter and flips for
// the next caller.

import { configStateDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";

const TOGGLE_PATH = configStateDocPath().replace("/state", "/ab-toggle");

export type Variant = "A" | "B";

export async function getAndToggleVariant(
  client: FirestoreClient = getFirestoreClient(),
): Promise<Variant> {
  try {
    const existing = await client.get(TOGGLE_PATH);
    const current = (existing?.value === 1 || existing?.value === "1") ? "B" : "A";
    const next = current === "A" ? 1 : 0;
    await client.set(TOGGLE_PATH, { value: next, updatedAt: new Date().toISOString() });
    return current;
  } catch (e) {
    console.error("[ab-test] toggle failed, defaulting to A:", e);
    return "A";
  }
}
