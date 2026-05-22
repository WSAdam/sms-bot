// In-memory FirestoreClient for unit tests. Mirrors the interface in
// shared/firestore/wrapper.ts. Doc paths are slash-delimited strings; "list"
// returns all docs whose path starts with `${parentPath}/` and have exactly
// one more segment (i.e. direct children, like a Firestore subcollection).

import type {
  AtomicCreateResult,
  BatchOp,
  FirestoreClient,
  ListOptions,
  ListResult,
} from "@shared/firestore/wrapper.ts";

export class FirestoreMock implements FirestoreClient {
  // Exposed for tests that want to introspect raw storage.
  readonly docs = new Map<string, Record<string, unknown>>();

  get(path: string): Promise<Record<string, unknown> | null> {
    return Promise.resolve(structuredClone(this.docs.get(path) ?? null));
  }

  set(path: string, data: Record<string, unknown>): Promise<void> {
    this.docs.set(path, structuredClone(data));
    return Promise.resolve();
  }

  delete(path: string): Promise<void> {
    this.docs.delete(path);
    return Promise.resolve();
  }

  list(parentPath: string, opts: ListOptions = {}): Promise<ListResult[]> {
    const prefix = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
    let entries: ListResult[] = [];

    for (const [path, data] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue; // skip grand-children
      entries.push({ id: rest, data: structuredClone(data) });
    }

    if (opts.where) {
      const { field, op, value } = opts.where;
      entries = entries.filter((e) => {
        const v = e.data[field];
        switch (op) {
          case "==":
            return v === value;
          case "<":
            return compare(v, value) < 0;
          case "<=":
            return compare(v, value) <= 0;
          case ">":
            return compare(v, value) > 0;
          case ">=":
            return compare(v, value) >= 0;
        }
      });
    }

    if (opts.orderBy) {
      const { field, dir } = opts.orderBy;
      entries.sort((a, b) => {
        const c = compare(a.data[field], b.data[field]);
        return dir === "asc" ? c : -c;
      });
    }

    if (opts.startAfter) {
      const idx = entries.findIndex((e) => e.id === opts.startAfter);
      if (idx >= 0) entries = entries.slice(idx + 1);
    }

    if (typeof opts.limit === "number") {
      entries = entries.slice(0, opts.limit);
    }

    return Promise.resolve(entries);
  }

  batch(ops: BatchOp[]): Promise<void> {
    for (const op of ops) {
      if (op.type === "set") {
        this.docs.set(op.path, structuredClone(op.data));
      } else if (op.type === "delete") {
        this.docs.delete(op.path);
      }
    }
    return Promise.resolve();
  }

  atomicCreate(
    path: string,
    data: Record<string, unknown>,
  ): Promise<AtomicCreateResult> {
    return this.withLock(() => {
      const existing = this.docs.get(path);
      if (existing) {
        return {
          created: false,
          existing: structuredClone(existing),
        };
      }
      this.docs.set(path, structuredClone(data));
      return { created: true, existing: null };
    });
  }

  incrementField(
    path: string,
    fields: Record<string, number>,
  ): Promise<void> {
    return this.withLock(() => {
      const existing = this.docs.get(path) ?? {};
      const next = { ...existing };
      for (const [k, n] of Object.entries(fields)) {
        const cur = typeof next[k] === "number" ? next[k] as number : 0;
        next[k] = cur + n;
      }
      this.docs.set(path, structuredClone(next));
    });
  }

  setMerge(path: string, data: Record<string, unknown>): Promise<void> {
    return this.withLock(() => {
      const existing = this.docs.get(path) ?? {};
      this.docs.set(path, structuredClone({ ...existing, ...data }));
    });
  }

  transactionalUpdate(
    path: string,
    fn: (existing: Record<string, unknown> | null) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.withLock(() => {
      const existing = this.docs.get(path) ?? null;
      const next = fn(existing ? structuredClone(existing) : null);
      this.docs.set(path, structuredClone(next));
      return structuredClone(next);
    });
  }

  // Test helpers
  reset(): void {
    this.docs.clear();
  }

  size(): number {
    return this.docs.size;
  }

  // Serializes concurrent mutations through a Promise chain so concurrent
  // incrementField / atomicCreate / transactionalUpdate calls don't lose
  // updates. Mirrors the atomicity Firestore provides server-side from the
  // SDK's point of view, which is what the unit tests for race-condition
  // fixes need to assert against.
  // deno-lint-ignore no-explicit-any
  private mutationLock: Promise<any> = Promise.resolve();
  private withLock<T>(fn: () => T): Promise<T> {
    const next = this.mutationLock.then(() => fn());
    this.mutationLock = next.catch(() => {});
    return next;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
