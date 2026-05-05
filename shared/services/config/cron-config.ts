// Live-editable cron configuration. Stored in Firestore at
// sms-bot/config/settings/cronConfig so Adam can update recipients /
// subject / reportId / enabled flags from the dashboard without a deploy.
//
// Schedule TIMES are NOT in here — Deno.cron registrations happen at
// module load (main.ts) and can't be re-registered live. Changing the
// 4 AM EST schedule still requires a code change. The `scheduleNote`
// fields here are display-only annotations for the dashboard.

import { cronConfigDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";

export interface ReportConfig {
  recipients: string; // comma-separated emails (Postmark accepts this format)
  subjectPrefix: string; // e.g. "[REPORT]"
  enabled: boolean; // false = cron skips the email
  scheduleNote: string; // human display only, e.g. "4:15 AM EST daily"
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
    scheduleNote: "4:15 AM EST daily (09:15 UTC)",
  },
  qbSaleMatch: {
    reportId: "530",
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

export async function setCronConfig(
  partial: Partial<Pick<CronConfig, "report" | "qbSaleMatch">>,
  client: FirestoreClient = getFirestoreClient(),
): Promise<CronConfig> {
  const current = await getCronConfig(client);
  const next: CronConfig = {
    report: { ...current.report, ...(partial.report ?? {}) },
    qbSaleMatch: { ...current.qbSaleMatch, ...(partial.qbSaleMatch ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  await client.set(
    cronConfigDocPath(),
    next as unknown as Record<string, unknown>,
  );
  return next;
}
