// Daily morning report builder + sender. Subject was historically the
// "nightly" report — file/function names kept for backwards compat with
// /api/report/nightly. The body has been rebuilt to match Adam's spec:
//
//   "Daily morning report"
//                          Week to date | Lifetime
//   Text Sent (unique recipients)
//   Appts Booked
//   Activations
//
//   [Link to dashboard at top]
//
// WTD = Monday 00:00 ET of the current week through the cron run moment.
// Lifetime = all-time.

import {
  guestActivatedCollection,
  injectionHistoryCollection,
  scheduledInjectionsCollection,
  uniqueRecipientByPhoneCollection,
  weeklyRecipientByPhoneWeekCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { getCronConfig } from "@shared/services/config/cron-config.ts";
import { sendReport } from "@shared/services/postmark/client.ts";
import {
  easternDateString,
  easternMondayDateString,
} from "@shared/util/time.ts";

const LIST_LIMIT = 50_000;
const DASHBOARD_URL = "https://sms-bot.thetechgoose.deno.net/dashboard";

export interface DailyReportCounts {
  textsSentWtd: number; // unique recipient phones, WTD
  textsSentLifetime: number; // unique recipient phones, all time
  apptsBookedWtd: number;
  apptsBookedLifetime: number;
  activationsWtd: number;
  activationsLifetime: number;
}

export interface NightlyReportResult {
  date: string;
  counts: DailyReportCounts;
}

// Monday 00:00:00 of the current ISO week, expressed as a UTC ms. ET is
// UTC-4 (EDT) / UTC-5 (EST). We approximate with -4 since the report
// runs spring-summer-fall ~85% of the year; the ±1h DST drift only
// matters for messages sent in the first/last hour of Monday morning ET
// during winter, which is acceptable for a high-level rollup.
function startOfWeekMsEt(now: Date = new Date()): number {
  // Convert "now" to a wall-clock-in-ET date by shifting -4h.
  const etNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const dow = etNow.getUTCDay(); // 0=Sun..6=Sat
  // Days since Monday: Sun→6, Mon→0, Tue→1, ...
  const daysSinceMonday = (dow + 6) % 7;
  const mondayEt = new Date(etNow);
  mondayEt.setUTCDate(etNow.getUTCDate() - daysSinceMonday);
  mondayEt.setUTCHours(0, 0, 0, 0);
  // Shift back to UTC by adding 4h (i.e. Mon 00:00 ET = Mon 04:00 UTC).
  return mondayEt.getTime() + 4 * 60 * 60 * 1000;
}

function safeMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

async function build(reportDate: string): Promise<{
  html: string;
  text: string;
  counts: DailyReportCounts;
}> {
  const db = getFirestoreClient();
  const weekStartMs = startOfWeekMsEt();
  const currentWeekKey = easternMondayDateString();

  // Texts-sent metrics come from the write-side recipient markers
  // (uniquerecipientbyphone + weeklyrecipientbyphoneweek) so we don't
  // scan the conversations collection — that scan was the 2026-05-19
  // Firestore-quota incident. See firestore-safety.md. WTD filter is a
  // single equality on weekKey so the scan is bounded to one week of
  // recipients.
  const [pending, history, activated, lifetimeRecipientDocs, wtdRecipientDocs] =
    await Promise.all([
      db.list(scheduledInjectionsCollection, { limit: LIST_LIMIT }),
      db.list(injectionHistoryCollection, { limit: LIST_LIMIT }),
      db.list(guestActivatedCollection, { limit: LIST_LIMIT }),
      db.list(uniqueRecipientByPhoneCollection, { limit: LIST_LIMIT }),
      db.list(weeklyRecipientByPhoneWeekCollection, {
        where: { field: "weekKey", op: "==", value: currentWeekKey },
        limit: LIST_LIMIT,
      }),
    ]);

  // --- Texts Sent (unique recipients) ---
  // One doc per unique recipient (lifetime) and one per recipient-per-week
  // (WTD), written write-side after every successful outbound SMS. See
  // shared/services/readymode/service.ts → recordOutboundRecipientMarkers.
  // Historical recipients from before the 2026-05-19 fix are not in
  // these collections — run scripts/backfill-recipient-markers.ts once
  // to seed lifetime from the existing conversations data.
  const lifetimeUniquePhones = lifetimeRecipientDocs.length;
  const wtdUniquePhones = wtdRecipientDocs.length;

  // --- Appts Booked ---
  // Source of truth is the same as the dashboard "Booked" stat: union of
  // scheduledinjections (id == phone10) and injectionhistory (id prefix
  // == phone10). Dedupe by phone, keep earliest booking time.
  const earliestBookingByPhone = new Map<string, number | null>();
  function recordBooking(phone: string, ms: number | null): void {
    if (!phone) return;
    const prev = earliestBookingByPhone.get(phone);
    if (prev === undefined) {
      earliestBookingByPhone.set(phone, ms);
    } else if (ms != null && (prev == null || ms < prev)) {
      earliestBookingByPhone.set(phone, ms);
    }
  }
  for (const e of pending) {
    const d = e.data as Record<string, unknown>;
    recordBooking(String(d.phone ?? e.id), safeMs(d.scheduledAt));
  }
  for (const e of history) {
    const d = e.data as Record<string, unknown>;
    const sep = e.id.indexOf("__");
    const phone = String(d.phone ?? (sep > 0 ? e.id.slice(0, sep) : e.id));
    recordBooking(phone, safeMs(d.firedAt));
  }
  let apptsBookedLifetime = 0;
  let apptsBookedWtd = 0;
  for (const ms of earliestBookingByPhone.values()) {
    apptsBookedLifetime++;
    if (ms != null && ms >= weekStartMs) apptsBookedWtd++;
  }

  // --- Activations ---
  let activationsLifetime = 0;
  let activationsWtd = 0;
  for (const e of activated) {
    activationsLifetime++;
    const d = e.data as Record<string, unknown>;
    const ms = safeMs(d.activatedAt);
    if (ms != null && ms >= weekStartMs) activationsWtd++;
  }

  const counts: DailyReportCounts = {
    textsSentWtd: wtdUniquePhones,
    textsSentLifetime: lifetimeUniquePhones,
    apptsBookedWtd,
    apptsBookedLifetime,
    activationsWtd,
    activationsLifetime,
  };

  const rows: Array<[string, number, number]> = [
    [
      "Text Sent (unique recipients)",
      counts.textsSentWtd,
      counts.textsSentLifetime,
    ],
    ["Appts Booked", counts.apptsBookedWtd, counts.apptsBookedLifetime],
    ["Activations", counts.activationsWtd, counts.activationsLifetime],
  ];

  const fmt = (n: number) => n.toLocaleString("en-US");

  const html =
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;padding:24px;color:#222">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
    <p style="margin:0 0 16px 0">
      <a href="${DASHBOARD_URL}" style="color:#0a6;text-decoration:none;font-weight:600">→ Open Dashboard</a>
    </p>
    <h2 style="margin:0 0 4px 0;font-size:1.25rem">Daily morning report</h2>
    <p style="margin:0 0 18px 0;color:#666;font-size:.85rem">${reportDate} ET</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:.95rem">
      <thead>
        <tr>
          <th style="text-align:left;border-bottom:2px solid #222"></th>
          <th style="text-align:right;border-bottom:2px solid #222;padding-right:12px">Week to date</th>
          <th style="text-align:right;border-bottom:2px solid #222">Lifetime</th>
        </tr>
      </thead>
      <tbody>
        ${
      rows
        .map(([label, wtd, lt]) =>
          `<tr>
          <td style="border-bottom:1px solid #eee">${label}</td>
          <td style="border-bottom:1px solid #eee;text-align:right;padding-right:12px"><b>${
            fmt(wtd)
          }</b></td>
          <td style="border-bottom:1px solid #eee;text-align:right"><b>${
            fmt(lt)
          }</b></td>
        </tr>`
        )
        .join("")
    }
      </tbody>
    </table>
  </div>
</body></html>`;

  const text = [
    `Daily morning report — ${reportDate} ET`,
    `Dashboard: ${DASHBOARD_URL}`,
    ``,
    `                              Week to date    Lifetime`,
    ...rows.map(([label, wtd, lt]) =>
      `${label.padEnd(34)}${String(fmt(wtd)).padStart(8)}${
        String(fmt(lt)).padStart(12)
      }`
    ),
  ].join("\n");

  return { html, text, counts };
}

export interface NightlyReportOptions {
  /** When true, runs even if cron config has report.enabled=false. */
  forceSend?: boolean;
}

export async function runNightlyReport(
  date?: string,
  options: NightlyReportOptions = {},
): Promise<NightlyReportResult & { skipped?: boolean; reason?: string }> {
  const reportDate = date ?? easternDateString();
  const cfg = (await getCronConfig()).report;

  if (!cfg.enabled && !options.forceSend) {
    console.log(`[report] ⏭ skipped — report.enabled=false in cron config`);
    return {
      date: reportDate,
      counts: {
        textsSentWtd: 0,
        textsSentLifetime: 0,
        apptsBookedWtd: 0,
        apptsBookedLifetime: 0,
        activationsWtd: 0,
        activationsLifetime: 0,
      },
      skipped: true,
      reason: "disabled in cron config",
    };
  }

  const r = await build(reportDate);

  await sendReport({
    to: cfg.recipients,
    subject: `${cfg.subjectPrefix} Daily morning report — ${reportDate}`,
    htmlBody: r.html,
    textBody: r.text,
  });

  console.log(
    `[report] ✅ sent to "${cfg.recipients}" — ` +
      `texts wtd=${r.counts.textsSentWtd}/lt=${r.counts.textsSentLifetime} ` +
      `appts wtd=${r.counts.apptsBookedWtd}/lt=${r.counts.apptsBookedLifetime} ` +
      `acts wtd=${r.counts.activationsWtd}/lt=${r.counts.activationsLifetime}`,
  );
  return { date: reportDate, counts: r.counts };
}

export function yesterdayEasternDateString(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return easternDateString(yesterday);
}
