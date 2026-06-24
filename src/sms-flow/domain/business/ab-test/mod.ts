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
    // Read-flip-write INSIDE a single Firestore transaction. The previous
    // get()+set() pair was non-atomic: two concurrent SMS triggers could both
    // read value=0, both compute next=1, and both return "A" — collapsing the
    // intended A,B,A,B alternation. transactionalUpdate re-reads the live doc
    // and writes the flipped value atomically, so each caller gets a distinct
    // slot (mirrors reserveGlobalDailySlot / setGatesConfig).
    let current: Variant = "A";
    await client.transactionalUpdate(TOGGLE_PATH, (existing) => {
      current = (existing?.value === 1 || existing?.value === "1") ? "B" : "A";
      const next = current === "A" ? 1 : 0;
      return {
        ...(existing ?? {}),
        value: next,
        updatedAt: new Date().toISOString(),
      };
    });
    return current;
  } catch (e) {
    console.error("[ab-test] toggle failed, defaulting to A:", e);
    return "A";
  }
}
