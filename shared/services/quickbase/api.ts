// Low-level Quickbase REST API client. Mirrors the proven pattern from the
// auto-bot project: 30s timeout, 3 retries with backoff (2s, 5s, 10s), retry
// on network errors and 429/5xx. OTEL spans dropped — not in this project.
//
// Auth: realm + table layout are hardcoded in shared/config/constants.ts.
// Only QUICKBASE_USER_TOKEN comes from env.

import {
  QUICKBASE_API_BASE,
  QUICKBASE_REALM_HOST,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";

const QB_TIMEOUT_MS = 30_000;
const QB_RETRY_DELAYS = [2000, 5000, 10000];

function headers(): Record<string, string> {
  const env = loadEnv();
  if (!env.quickbaseUserToken) {
    throw new Error("Missing QUICKBASE_USER_TOKEN");
  }
  return {
    "QB-Realm-Hostname": QUICKBASE_REALM_HOST,
    "User-Agent": "sms-bot",
    Authorization: `QB-USER-TOKEN ${env.quickbaseUserToken}`,
    "Content-Type": "application/json",
  };
}

export interface QbQueryOptions {
  tableId: string;
  where: string;
  select: number[];
  sortBy?: { fieldId: number; order: "ASC" | "DESC" }[];
}

// Each record comes back as { "<fid>": { value: ... }, ... }
export type QbRecord = Record<string, { value: unknown } | undefined>;

export async function queryRecords(
  opts: QbQueryOptions,
  attempt = 0,
): Promise<QbRecord[]> {
  const body: Record<string, unknown> = {
    from: opts.tableId,
    where: opts.where,
    select: opts.select,
  };
  if (opts.sortBy) body.sortBy = opts.sortBy;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${QUICKBASE_API_BASE}/records/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = String((e as Error)?.message ?? e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    const label = isTimeout ? `timed out after ${QB_TIMEOUT_MS / 1000}s` : msg;
    if (attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(
        `[qb] queryRecords attempt ${attempt + 1} ${label} — retry in ${delay}ms (table=${opts.tableId})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
    throw new Error(
      `Quickbase query failed after ${attempt + 1} attempts: ${label} (table=${opts.tableId})`,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(
        `[qb] queryRecords attempt ${attempt + 1} got ${res.status} — retry in ${delay}ms (table=${opts.tableId})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
    throw new Error(
      `Quickbase query failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const data = await res.json();
  return (data.data ?? []) as QbRecord[];
}

// POST /records — Quickbase upsert. Pass records keyed by FID; the FID matching
// `mergeFieldId` (typically the record-id field) makes it an UPDATE if the row
// exists, INSERT if it doesn't.
export interface QbUpsertOptions {
  tableId: string;
  data: Array<Record<string, { value: unknown }>>;
  mergeFieldId?: number;
  fieldsToReturn?: number[];
}

export async function upsertRecords(
  opts: QbUpsertOptions,
  attempt = 0,
): Promise<{ data: QbRecord[]; metadata?: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    to: opts.tableId,
    data: opts.data,
  };
  if (opts.mergeFieldId) body.mergeFieldId = opts.mergeFieldId;
  if (opts.fieldsToReturn) body.fieldsToReturn = opts.fieldsToReturn;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${QUICKBASE_API_BASE}/records`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = String((e as Error)?.message ?? e);
    if (attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(
        `[qb] upsertRecords attempt ${attempt + 1} ${msg} — retry in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return upsertRecords(opts, attempt + 1);
    }
    throw new Error(`Quickbase upsert failed: ${msg}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(
        `[qb] upsertRecords attempt ${attempt + 1} got ${res.status} — retry in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return upsertRecords(opts, attempt + 1);
    }
    throw new Error(`Quickbase upsert failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return await res.json();
}
