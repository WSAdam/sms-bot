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
} from "@core/business/constants/mod.ts";
import { gatesConfigDocPath } from "@core/data/firestore-paths/mod.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@core/data/firestore-wrapper/mod.ts";

export interface GatesConfig {
  attemptsThreshold: number; // min times_called before we'll text
  saleMatchWindowDays: number; // days between appt and QB sale to credit
  globalDailySmsCap: number; // total system-wide texts per day
  rateLimitWindowDays: number; // per-phone cooldown in days
  // Profitability — used to drive the Cost / Earnings / Profit cards on
  // the dashboard. Defaults assume $0 cost (so cost stays zero until
  // Adam fills in the real number) and $50 estimated revenue per
  // credited sale.
  costPerText: number; // USD per outbound SMS
  earningsPerSale: number; // USD revenue per credited activation
  // RM TPI throttle (live-editable so the operator can tighten/loosen
  // without redeploying). The TPI lookup runs on every trigger whose
  // upstream attempts field is the (times_called) placeholder; we don't
  // want to hammer RM. Default spacing 2s + 30 calls per 5-minute window
  // is comfortably under RM's tolerance for the ACT volume.
  tpiMinSpacingMs: number; // min ms between TPI calls
  tpiMaxPer5Min: number; // sliding-window cap on TPI calls
  // Scheduled-injection sweep safety. After the 2026-05-25 incident where
  // 19 stale pending docs almost got dialed when the cron came back from
  // a 22-day silent outage, we need a runtime kill-switch + a dedup
  // window. The sweep is paused by default; flip the bool here to arm it.
  // Dedup blocks handleDelayedInjection from re-dialing any phone that
  // already has an injectionhistory entry within the last N hours.
  scheduledInjectionSweepEnabled: boolean;
  scheduledInjectionDedupHours: number;
  updatedAt: string;
}

export const GATES_CONFIG_DEFAULTS: GatesConfig = {
  attemptsThreshold: ATTEMPTS_GATEKEEPER_THRESHOLD,
  saleMatchWindowDays: SALE_MATCH_WINDOW_DAYS,
  globalDailySmsCap: GLOBAL_DAILY_SMS_CAP,
  rateLimitWindowDays: RATE_LIMIT_WINDOW_DAYS,
  costPerText: 0,
  earningsPerSale: 50,
  tpiMinSpacingMs: 2000,
  tpiMaxPer5Min: 30,
  scheduledInjectionSweepEnabled: false,
  scheduledInjectionDedupHours: 72,
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
    costPerText: numOr(
      doc.costPerText,
      GATES_CONFIG_DEFAULTS.costPerText,
    ),
    earningsPerSale: numOr(
      doc.earningsPerSale,
      GATES_CONFIG_DEFAULTS.earningsPerSale,
    ),
    tpiMinSpacingMs: numOr(
      doc.tpiMinSpacingMs,
      GATES_CONFIG_DEFAULTS.tpiMinSpacingMs,
    ),
    tpiMaxPer5Min: numOr(
      doc.tpiMaxPer5Min,
      GATES_CONFIG_DEFAULTS.tpiMaxPer5Min,
    ),
    scheduledInjectionSweepEnabled:
      typeof doc.scheduledInjectionSweepEnabled === "boolean"
        ? doc.scheduledInjectionSweepEnabled
        : GATES_CONFIG_DEFAULTS.scheduledInjectionSweepEnabled,
    scheduledInjectionDedupHours: numOr(
      doc.scheduledInjectionDedupHours,
      GATES_CONFIG_DEFAULTS.scheduledInjectionDedupHours,
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
  partial: Partial<
    Pick<
      GatesConfig,
      | "attemptsThreshold"
      | "saleMatchWindowDays"
      | "globalDailySmsCap"
      | "rateLimitWindowDays"
      | "costPerText"
      | "earningsPerSale"
      | "tpiMinSpacingMs"
      | "tpiMaxPer5Min"
      | "scheduledInjectionSweepEnabled"
      | "scheduledInjectionDedupHours"
    >
  >,
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
    costPerText: partial.costPerText ?? current.costPerText,
    earningsPerSale: partial.earningsPerSale ?? current.earningsPerSale,
    tpiMinSpacingMs: partial.tpiMinSpacingMs ?? current.tpiMinSpacingMs,
    tpiMaxPer5Min: partial.tpiMaxPer5Min ?? current.tpiMaxPer5Min,
    scheduledInjectionSweepEnabled: partial.scheduledInjectionSweepEnabled ??
      current.scheduledInjectionSweepEnabled,
    scheduledInjectionDedupHours: partial.scheduledInjectionDedupHours ??
      current.scheduledInjectionDedupHours,
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
