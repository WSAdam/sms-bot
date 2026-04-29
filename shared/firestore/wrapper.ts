// FirestoreClient interface + real implementation backed by firebase-admin.
// Real impl uses dynamic import of firebase-admin so Vite SSR doesn't try to
// resolve the npm CJS module at route-module-load time. The in-memory mock in
// tests/mocks/firestore-mock.ts satisfies the same interface so unit tests
// stay client-agnostic.
//
// Path convention: full slash-delimited paths starting with "sms-bot/...".
// Doc paths have an even number of segments after the root collection;
// collection paths have an odd number.

import { getDb } from "@shared/firestore/client.ts";

export type DocPath = string;

export interface OrderBy {
  field: string;
  dir: "asc" | "desc";
}

export interface ListOptions {
  limit?: number;
  startAfter?: string;
  orderBy?: OrderBy;
  where?: { field: string; op: "<=" | "<" | ">=" | ">" | "=="; value: unknown };
}

export interface ListResult {
  id: string;
  data: Record<string, unknown>;
}

export type BatchOp =
  | { type: "set"; path: DocPath; data: Record<string, unknown> }
  | { type: "delete"; path: DocPath };

export interface AtomicCreateResult {
  created: boolean;
  existing: Record<string, unknown> | null;
}

export interface FirestoreClient {
  get(path: DocPath): Promise<Record<string, unknown> | null>;
  set(path: DocPath, data: Record<string, unknown>): Promise<void>;
  delete(path: DocPath): Promise<void>;
  list(parentPath: string, opts?: ListOptions): Promise<ListResult[]>;
  batch(ops: BatchOp[]): Promise<void>;
  atomicCreate(
    path: DocPath,
    data: Record<string, unknown>,
  ): Promise<AtomicCreateResult>;
}

const MAX_BATCH = 400;

class FirebaseAdminClient implements FirestoreClient {
  async get(path: DocPath): Promise<Record<string, unknown> | null> {
    const db = await getDb();
    const snap = await db.doc(path).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  }

  async set(path: DocPath, data: Record<string, unknown>): Promise<void> {
    const db = await getDb();
    await db.doc(path).set(data, { merge: false });
  }

  async delete(path: DocPath): Promise<void> {
    const db = await getDb();
    await db.doc(path).delete();
  }

  async list(parentPath: string, opts: ListOptions = {}): Promise<ListResult[]> {
    const db = await getDb();
    // deno-lint-ignore no-explicit-any
    let q: any = db.collection(parentPath);

    if (opts.where) {
      q = q.where(opts.where.field, opts.where.op, opts.where.value);
    }
    if (opts.orderBy) {
      q = q.orderBy(opts.orderBy.field, opts.orderBy.dir);
    }
    if (opts.startAfter) {
      q = q.startAfter(opts.startAfter);
    }
    if (typeof opts.limit === "number") {
      q = q.limit(opts.limit);
    }

    const snap = await q.get();
    // deno-lint-ignore no-explicit-any
    return snap.docs.map((d: any) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
    }));
  }

  async batch(ops: BatchOp[]): Promise<void> {
    if (ops.length === 0) return;
    const db = await getDb();
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
      const chunk = ops.slice(i, i + MAX_BATCH);
      const batch = db.batch();
      for (const op of chunk) {
        const ref = db.doc(op.path);
        if (op.type === "set") batch.set(ref, op.data);
        else batch.delete(ref);
      }
      await batch.commit();
    }
  }

  async atomicCreate(
    path: DocPath,
    data: Record<string, unknown>,
  ): Promise<AtomicCreateResult> {
    const db = await getDb();
    const ref = db.doc(path);
    // deno-lint-ignore no-explicit-any
    return await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return {
          created: false,
          existing: snap.data() as Record<string, unknown>,
        };
      }
      tx.create(ref, data);
      return { created: true, existing: null };
    });
  }
}

let cached: FirestoreClient | null = null;

export function getFirestoreClient(): FirestoreClient {
  if (!cached) cached = new FirebaseAdminClient();
  return cached;
}

export function setFirestoreClientForTests(c: FirestoreClient | null): void {
  cached = c;
}
