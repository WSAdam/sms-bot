// FirestoreClient interface + real implementation backed by firebase-admin.
// Real impl uses dynamic import of firebase-admin so Vite SSR doesn't try to
// resolve the npm CJS module at route-module-load time. The in-memory mock in
// tests/mocks/firestore-mock.ts satisfies the same interface so unit tests
// stay client-agnostic.
//
// Path convention: full slash-delimited paths starting with "sms-bot/...".
// Doc paths have an even number of segments after the root collection;
// collection paths have an odd number.

import { getAdminFirestore, getDb } from "@core/data/firestore-client/mod.ts";
import { withTiming } from "@core/business/timing/mod.ts";

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
  // FieldValue.increment(n) on each named field, via set({merge:true}).
  // Concurrent calls are race-free on Firestore's side — no need for a
  // transaction. Used for counters (daily SMS count, lifetime metrics,
  // per-phone aggregator counts).
  incrementField(
    path: DocPath,
    fields: Record<string, number>,
  ): Promise<void>;
  // set(data, {merge:true}) — upserts the listed fields without
  // clobbering the rest of the doc. Use for "stamp lastUpdatedAt and
  // leave everything else alone" semantics.
  setMerge(path: DocPath, data: Record<string, unknown>): Promise<void>;
  // Read-modify-write inside a Firestore runTransaction. The closure
  // receives the existing doc (or null) and returns the next doc state.
  // Use when conditional logic depends on the current value (e.g.
  // "set firstSeen only if not already set" or "merge two pointer
  // updates without losing fields").
  transactionalUpdate(
    path: DocPath,
    fn: (existing: Record<string, unknown> | null) => Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

const MAX_BATCH = 400;

// Tripwire for the "list everything, filter in memory" pattern that
// caused the 2026-05-19 quota incident. Any list() that returns more
// than this threshold logs a loud warning with a stack trace so the
// pattern surfaces in the logs the next time someone reintroduces it.
// 500 matches the historical "default limit" that the May 5 change
// raised — anything above is by definition outside the polite range.
// Override via env if a known-large scan needs to opt out without
// noise (only the nightly report / migration scripts should ever do
// this; everything else should rewrite as a targeted query).
const LIST_RESULT_WARN_THRESHOLD = Number(
  Deno.env.get("FIRESTORE_LIST_WARN_THRESHOLD") ?? 500,
);

// Transient network failures on Deno Deploy's REST transport (a DNS hiccup =
// `getaddrinfo EAI_AGAIN`, a dropped socket = ECONNRESET / "socket hang up",
// Firestore's own UNAVAILABLE) are almost always gone on an immediate retry. We
// retry idempotent READS a few times with short backoff so a blip never reaches
// callers — a gates-config read that fell through to defaults silently DISARMED
// the injection sweep (incident 2026-06-29). Writes are NOT auto-retried here:
// incrementField isn't idempotent, and transactionalUpdate already retries
// inside Firestore.
const TRANSIENT_ERROR_RE =
  /EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|getaddrinfo|Connection reset|UNAVAILABLE|DEADLINE_EXCEEDED/i;

export function isTransientFirestoreError(e: unknown): boolean {
  const err = e as { code?: string; errno?: string; message?: string } | null;
  if (!err) return false;
  const code = String(err.code ?? "") + " " + String(err.errno ?? "");
  if (TRANSIENT_ERROR_RE.test(code)) return true;
  return TRANSIENT_ERROR_RE.test(String(err.message ?? ""));
}

export async function withTransientRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === attempts || !isTransientFirestoreError(e)) throw e;
      const backoffMs = 150 * attempt;
      console.warn(
        `⚠️ [firestore] transient error on ${label} ` +
          `(attempt ${attempt}/${attempts}); retrying in ${backoffMs}ms: ${
            (e as Error).message
          }`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

class FirebaseAdminClient implements FirestoreClient {
  get(path: DocPath): Promise<Record<string, unknown> | null> {
    return withTiming(
      `firestore.get ${path}`,
      () =>
        withTransientRetry(`get ${path}`, async () => {
          const db = await getDb();
          const snap = await db.doc(path).get();
          return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        }),
    );
  }

  set(path: DocPath, data: Record<string, unknown>): Promise<void> {
    return withTiming(`firestore.set ${path}`, async () => {
      const db = await getDb();
      await db.doc(path).set(data, { merge: false });
    });
  }

  delete(path: DocPath): Promise<void> {
    return withTiming(`firestore.delete ${path}`, async () => {
      auditCriticalDelete(path);
      const db = await getDb();
      await db.doc(path).delete();
    });
  }

  list(
    parentPath: string,
    opts: ListOptions = {},
  ): Promise<ListResult[]> {
    return withTiming(
      `firestore.list ${parentPath}`,
      () =>
        withTransientRetry(`list ${parentPath}`, async () => {
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
          if (snap.size > LIST_RESULT_WARN_THRESHOLD) {
            auditLargeListResult(parentPath, snap.size, opts);
          }
          // deno-lint-ignore no-explicit-any
          return snap.docs.map((d: any) => ({
            id: d.id,
            data: d.data() as Record<string, unknown>,
          }));
        }),
    );
  }

  batch(ops: BatchOp[]): Promise<void> {
    return withTiming(`firestore.batch (${ops.length} ops)`, async () => {
      if (ops.length === 0) return;
      for (const op of ops) {
        if (op.type === "delete") auditCriticalDelete(op.path);
      }
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
    });
  }

  atomicCreate(
    path: DocPath,
    data: Record<string, unknown>,
  ): Promise<AtomicCreateResult> {
    return withTiming(`firestore.atomicCreate ${path}`, async () => {
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
    });
  }

  incrementField(
    path: DocPath,
    fields: Record<string, number>,
  ): Promise<void> {
    return withTiming(`firestore.incrementField ${path}`, async () => {
      const db = await getDb();
      const adminFs = await getAdminFirestore();
      const update: Record<string, unknown> = {};
      for (const [k, n] of Object.entries(fields)) {
        update[k] = adminFs.FieldValue.increment(n);
      }
      await db.doc(path).set(update, { merge: true });
    });
  }

  setMerge(
    path: DocPath,
    data: Record<string, unknown>,
  ): Promise<void> {
    return withTiming(`firestore.setMerge ${path}`, async () => {
      const db = await getDb();
      await db.doc(path).set(data, { merge: true });
    });
  }

  transactionalUpdate(
    path: DocPath,
    fn: (existing: Record<string, unknown> | null) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return withTiming(`firestore.transactionalUpdate ${path}`, async () => {
      const db = await getDb();
      const ref = db.doc(path);
      // deno-lint-ignore no-explicit-any
      return await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const existing = snap.exists
          ? (snap.data() as Record<string, unknown>)
          : null;
        const next = fn(existing);
        tx.set(ref, next);
        return next;
      });
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

// Critical collections we want to trace deletes from. Lifetime stat counts
// (Activated, etc.) silently lose entries when something deletes here, so
// any delete must leave a stack-trace breadcrumb in Deno Deploy logs.
const CRITICAL_DELETE_PATHS = [
  "guestactivated/byPhone",
  "saleswithin7d/byPhone",
];

function auditCriticalDelete(path: string): void {
  if (!CRITICAL_DELETE_PATHS.some((p) => path.includes(p))) return;
  const stack = new Error("delete trace").stack ?? "(no stack)";
  console.warn(
    `🚨 [firestore.delete] CRITICAL path=${path}\n${
      stack.split("\n").slice(2, 8).join("\n")
    }`,
  );
}

// Regression guard for the full-table-scan pattern that caused the
// 2026-05-19 quota incident. Logs a stack-trace breadcrumb so the
// offending call site is obvious in Deno Deploy logs. Does NOT throw —
// we never want this guard to take down a request path; surfacing the
// problem in logs is enough to catch it during normal review.
function auditLargeListResult(
  parentPath: string,
  returnedSize: number,
  opts: ListOptions,
): void {
  const stack = new Error("large list trace").stack ?? "(no stack)";
  console.warn(
    `⚠️ [firestore.list] returned=${returnedSize} threshold=${LIST_RESULT_WARN_THRESHOLD} ` +
      `path=${parentPath} where=${JSON.stringify(opts.where ?? null)} ` +
      `limit=${opts.limit ?? "(none)"}\n${
        stack.split("\n").slice(2, 8).join("\n")
      }`,
  );
}
