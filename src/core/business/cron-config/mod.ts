// Live-editable cron configuration. Stored in Firestore at
// sms-bot/config/settings/cronConfig so Adam can update recipients /
// subject / reportId / enabled flags from the dashboard without a deploy.
//
// Schedule TIMES are NOT in here — Deno.cron registrations happen at
// module load (main.ts) and can't be re-registered live. Changing the
// 4 AM EST schedule still requires a code change. The `scheduleNote`
// fields here are display-only annotations for the dashboard.

import { cronConfigDocPath } from "@core/data/firestore-paths/mod.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@core/data/firestore-wrapper/mod.ts";

export interface ReportConfig {
  recipients: string; // comma-separated emails (Postmark accepts this format)
  subjectPrefix: string; // e.g. "[REPORT]"
  enabled: boolean; // false = cron skips the email
  // Time of day (Eastern, 24h "HH:MM") the cron should send. Live-editable
  // — the report cron now runs every minute and checks this field, so
  // changing the time takes effect within ~60s. No deploy required.
  timeOfDayEt: string;
  scheduleNote: string; // human display only — auto-recomputed from timeOfDayEt
  // System-managed: the ET date of the most recent successful send. Used
  // by the every-minute tick cron to ensure exactly-once delivery per
  // calendar day. Not exposed in the edit form.
  lastSentEtDate?: string;
}

export interface QbSaleMatchConfig {
  reportId: string;
  tableId: string;
  enabled: boolean;
  scheduleNote: string;
}

export interface CronConfig {
  report: ReportConfig;
  qbSaleMatch: QbSaleMatchConfig;
  updatedAt: string;
}

export const CRON_CONFIG_DEFAULTS: CronConfig = {
  report: {
    recipients: "adamp@monsterrg.com",
    subjectPrefix: "[REPORT]",
    enabled: true,
    timeOfDayEt: "04:15",
    scheduleNote: "04:15 ET daily",
  },
  qbSaleMatch: {
    // 530 was the original ODR-only report; 678 is the current "all
    // activations across all teams" report we actually run sale-match
    // against. Adam confirmed 678 weeks ago. The Firestore cronConfig
    // doc overrides this; if no doc exists (updatedAt == epoch), this
    // default is what the cron uses.
    reportId: "678",
    tableId: "bpb28qsnn",
    enabled: true,
    scheduleNote: "4:00 AM EST daily (09:00 UTC)",
  },
  updatedAt: new Date(0).toISOString(),
};

export async function getCronConfig(
  client: FirestoreClient = getFirestoreClient(),
): Promise<CronConfig> {
  const doc = await client.get(cronConfigDocPath());
  if (!doc) return CRON_CONFIG_DEFAULTS;
  // Shallow merge with defaults so newly-added fields don't 500 readers.
  return {
    report: { ...CRON_CONFIG_DEFAULTS.report, ...(doc.report ?? {}) },
    qbSaleMatch: {
      ...CRON_CONFIG_DEFAULTS.qbSaleMatch,
      ...(doc.qbSaleMatch ?? {}),
    },
    updatedAt: typeof doc.updatedAt === "string"
      ? doc.updatedAt
      : CRON_CONFIG_DEFAULTS.updatedAt,
  };
}

// Atomically claim the nightly-report send for `todayEt`. Inside a single
// Firestore transaction, set report.lastSentEtDate to todayEt ONLY if it isn't
// already todayEt. Returns true when THIS caller won the claim (clear to send),
// false when the day was already claimed.
//
// This closes the nightly-report TOCTOU: the previous flow read
// lastSentEtDate, checked it, sent the email, THEN wrote the marker — so two
// near-simultaneous cron fires (Deno Deploy retry / clock skew) both saw the
// stale value, both passed, and both sent. Claiming the day atomically BEFORE
// sending means only one invocation proceeds.
export async function claimReportDay(
  todayEt: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  let won = false;
  await client.transactionalUpdate(cronConfigDocPath(), (existing) => {
    const report = (existing?.report as Partial<ReportConfig> | undefined) ??
      {};
    if (report.lastSentEtDate === todayEt) {
      won = false;
      return existing ?? {};
    }
    won = true;
    return {
      ...(existing ?? {}),
      report: { ...report, lastSentEtDate: todayEt },
      updatedAt: new Date().toISOString(),
    };
  });
  return won;
}

export async function setCronConfig(
  partial: {
    report?: Partial<ReportConfig>;
    qbSaleMatch?: Partial<QbSaleMatchConfig>;
  },
  client: FirestoreClient = getFirestoreClient(),
): Promise<CronConfig> {
  // Read-merge-write INSIDE a Firestore transaction (mirrors setGatesConfig).
  // The previous getCronConfig()+set() pair was non-atomic: two concurrent
  // POST /api/config/cron requests editing DIFFERENT fields (e.g. report.enabled
  // vs qbSaleMatch.reportId) both read the same state and the later set()
  // clobbered the earlier change. The transaction re-reads the live doc and
  // merges this partial on top, so concurrent writes to different fields no
  // longer lose each other.
  let next: CronConfig = CRON_CONFIG_DEFAULTS;
  await client.transactionalUpdate(cronConfigDocPath(), (existing) => {
    // Merge the live doc with defaults the same way getCronConfig does, so a
    // partial doc (missing newly-added fields) doesn't drop them on write.
    const current: CronConfig = {
      report: {
        ...CRON_CONFIG_DEFAULTS.report,
        ...((existing?.report as Partial<ReportConfig> | undefined) ?? {}),
      },
      qbSaleMatch: {
        ...CRON_CONFIG_DEFAULTS.qbSaleMatch,
        ...((existing?.qbSaleMatch as Partial<QbSaleMatchConfig> | undefined) ??
          {}),
      },
      updatedAt: typeof existing?.updatedAt === "string"
        ? existing.updatedAt
        : CRON_CONFIG_DEFAULTS.updatedAt,
    };
    next = {
      report: { ...current.report, ...(partial.report ?? {}) },
      qbSaleMatch: { ...current.qbSaleMatch, ...(partial.qbSaleMatch ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    return next as unknown as Record<string, unknown>;
  });
  return next;
}
