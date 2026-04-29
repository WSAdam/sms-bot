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
          case "==": return v === value;
          case "<": return compare(v, value) < 0;
          case "<=": return compare(v, value) <= 0;
          case ">": return compare(v, value) > 0;
          case ">=": return compare(v, value) >= 0;
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
    const existing = this.docs.get(path);
    if (existing) {
      return Promise.resolve({
        created: false,
        existing: structuredClone(existing),
      });
    }
    this.docs.set(path, structuredClone(data));
    return Promise.resolve({ created: true, existing: null });
  }

  // Test helpers
  reset(): void {
    this.docs.clear();
  }

  size(): number {
    return this.docs.size;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
