// Higher-level transactional helpers built on the FirestoreClient interface.
// Mirrors the legacy Deno KV `kv.atomic().check({versionstamp: null})` claim
// pattern used by the audit endpoints.

import {
  type AtomicCreateResult,
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";

export interface ClaimResult {
  created: boolean;
  existing: Record<string, unknown> | null;
  timestamp: string | null;
}

export async function claim(
  path: string,
  data: Record<string, unknown>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<ClaimResult> {
  const r: AtomicCreateResult = await client.atomicCreate(path, data);
  const ts = r.existing && typeof r.existing === "object"
    ? (r.existing as Record<string, unknown>).processedAt as string ?? null
    : null;
  return { created: r.created, existing: r.existing, timestamp: ts };
}
