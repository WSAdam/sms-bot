// Live-editable operational gates. Stored in Firestore at
// sms-bot/config/settings/gatesConfig so Adam can adjust the four
// business-rule thresholds (attempts, sale-match window, daily SMS cap,
// per-phone rate-limit window) from the dashboard without a deploy.
//
// Every gate enforce-site reads through getGatesConfig(); the constants
// in shared/config/constants.ts remain as the FALLBACK defaults if
// Firestore is empty or unreachable.
//
// In-memory cache: 60s TTL. The attempts gate fires on every inbound
// trigger and the rate limiter on every text — paying a Firestore RTT
// per check would be punishing.

import {
  ATTEMPTS_GATEKEEPER_THRESHOLD,
  GLOBAL_DAILY_SMS_CAP,
  RATE_LIMIT_WINDOW_DAYS,
  SALE_MATCH_WINDOW_DAYS,
} from "@shared/config/constants.ts";
import { gatesConfigDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";

export interface GatesConfig {
  attemptsThreshold: number;     // min times_called before we'll text
  saleMatchWindowDays: number;   // days between appt and QB sale to credit
  globalDailySmsCap: number;     // total system-wide texts per day
  rateLimitWindowDays: number;   // per-phone cooldown in days
  updatedAt: string;
}

export const GATES_CONFIG_DEFAULTS: GatesConfig = {
  attemptsThreshold: ATTEMPTS_GATEKEEPER_THRESHOLD,
  saleMatchWindowDays: SALE_MATCH_WINDOW_DAYS,
  globalDailySmsCap: GLOBAL_DAILY_SMS_CAP,
  rateLimitWindowDays: RATE_LIMIT_WINDOW_DAYS,
  updatedAt: new Date(0).toISOString(),
};

const CACHE_TTL_MS = 60_000;
let cached: { at: number; value: GatesConfig } | null = null;

function mergeWithDefaults(doc: Record<string, unknown> | null): GatesConfig {
  if (!doc) return GATES_CONFIG_DEFAULTS;
  const numOr = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    attemptsThreshold: numOr(
      doc.attemptsThreshold,
      GATES_CONFIG_DEFAULTS.attemptsThreshold,
    ),
    saleMatchWindowDays: numOr(
      doc.saleMatchWindowDays,
      GATES_CONFIG_DEFAULTS.saleMatchWindowDays,
    ),
    globalDailySmsCap: numOr(
      doc.globalDailySmsCap,
      GATES_CONFIG_DEFAULTS.globalDailySmsCap,
    ),
    rateLimitWindowDays: numOr(
      doc.rateLimitWindowDays,
      GATES_CONFIG_DEFAULTS.rateLimitWindowDays,
    ),
    updatedAt: typeof doc.updatedAt === "string"
      ? doc.updatedAt
      : GATES_CONFIG_DEFAULTS.updatedAt,
  };
}

export async function getGatesConfig(
  client: FirestoreClient = getFirestoreClient(),
): Promise<GatesConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const doc = await client.get(gatesConfigDocPath());
    const value = mergeWithDefaults(doc);
    cached = { at: now, value };
    return value;
  } catch (e) {
    // Firestore unavailable — return defaults so gates still enforce.
    console.error("[gates-config] read failed, using defaults:", e);
    return GATES_CONFIG_DEFAULTS;
  }
}

export async function setGatesConfig(
  partial: Partial<Pick<GatesConfig, "attemptsThreshold" | "saleMatchWindowDays" | "globalDailySmsCap" | "rateLimitWindowDays">>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<GatesConfig> {
  const current = await getGatesConfig(client);
  const next: GatesConfig = {
    attemptsThreshold: partial.attemptsThreshold ?? current.attemptsThreshold,
    saleMatchWindowDays: partial.saleMatchWindowDays ??
      current.saleMatchWindowDays,
    globalDailySmsCap: partial.globalDailySmsCap ?? current.globalDailySmsCap,
    rateLimitWindowDays: partial.rateLimitWindowDays ??
      current.rateLimitWindowDays,
    updatedAt: new Date().toISOString(),
  };
  await client.set(
    gatesConfigDocPath(),
    next as unknown as Record<string, unknown>,
  );
  // Invalidate cache so the next read sees the new value immediately
  // (otherwise the writer would still see the stale cached row until TTL).
  cached = { at: Date.now(), value: next };
  return next;
}

// Test hook — clear the in-memory cache between unit tests that mutate
// the underlying doc. Production code should never call this.
export function _clearGatesConfigCache(): void {
  cached = null;
}
