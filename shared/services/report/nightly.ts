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
//
// Pre-fix this scanned scheduledinjections + injectionhistory +
// guestactivated (50k each) to compute the counters. Now reads:
//   - metrics/lifetime/totals — lifetime apptsBooked + activations
//   - metrics/daily/{YYYY-MM-DD} × 7 — WTD apptsBooked + activations
//   - uniquerecipientbyphone — lifetime textsSent (unique recipients)
//   - weeklyrecipientbyphoneweek (current week filter) — WTD textsSent
// See firestore-safety.md.
//
// Historical lifetime + back-dated daily counters are seeded by
// scripts/backfill-daily-metrics.ts.

import {
  metricsDailyDocPath,
  metricsLifetimeDocPath,
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

const DASHBOARD_URL = "https://sms-bot.thetechgoose.deno.net/dashboard";

export interface DailyReportCounts {
  textsSentWtd: number; // unique recipient phones, WTD
  textsSentLifetime: number; // unique recipient phones, all time
  apptsBookedWtd: number;
  apptsBookedLifetime: number;
  activationsWtd: number;
  activationsLifetime: number;
  // Yesterday's funnel — the most recent fully-settled ET day at the
  // 6:15 AM fire (answered + bookings finish collecting that morning).
  // All four read from the single metrics/daily/{yesterday} counter doc.
  yesterdayDate: string;
  ydSmsSent: number; // metrics/daily.textsSent (raw outbound)
  ydCallsScheduled: number; // metrics/daily.apptsBooked
  ydCallsAnswered: number; // metrics/daily.answered
  ydBookings: number; // metrics/daily.activations
}

export interface NightlyReportResult {
  date: string;
  counts: DailyReportCounts;
}

// Walk back 7 ET days from today, return YYYY-MM-DD strings. Today is
// included so a report fired before midnight ET still counts today's
// activations toward WTD.
function weekToDateEtDays(today: string = easternDateString()): string[] {
  const [y, m, d] = today.split("-").map((s) => Number(s));
  const base = new Date(Date.UTC(y, m - 1, d));
  const days: string[] = [];
  // Walk back until we cross last Monday (inclusive). ET Monday = ISO weekday 1.
  // We use UTC math here; the date strings are pure ET YYYY-MM-DD so
  // wall-clock offsets don't matter.
  for (let back = 0; back < 7; back++) {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() - back);
    const dow = dt.getUTCDay(); // 0=Sun..6=Sat
    days.push(
      `${dt.getUTCFullYear()}-${
        String(dt.getUTCMonth() + 1).padStart(2, "0")
      }-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
    if (dow === 1 && back > 0) break; // hit Monday — stop after including it
  }
  return days;
}

// The ET day before a given YYYY-MM-DD, via pure UTC date arithmetic (the
// wall-clock offset doesn't matter for date-component math on an ET string).
// Derived from reportDate — NOT the clock — so an ad-hoc ?date= back-fill run
// reports the day before THAT date, keeping the email header and the
// "Yesterday" block aligned.
function etDayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((s) => Number(s));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${
    String(dt.getUTCMonth() + 1).padStart(2, "0")
  }-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function build(reportDate: string): Promise<{
  html: string;
  text: string;
  counts: DailyReportCounts;
}> {
  const db = getFirestoreClient();
  const currentWeekKey = easternMondayDateString();
  const wtdDays = weekToDateEtDays(reportDate);
  const yesterdayDate = etDayBefore(reportDate);

  // All reads run in parallel — total cost is bounded by 1 lifetime doc
  // + 7 daily docs + the yesterday daily doc + uniquerecipientbyphone (the
  // lifetime unique count) + weeklyrecipientbyphoneweek filtered to the
  // current week. The unique-recipient collections are the only multi-doc
  // reads and they both have indexed where/list. No more full-table scans.
  const [
    lifetimeDoc,
    dailyDocs,
    lifetimeRecipientDocs,
    wtdRecipientDocs,
    yesterdayDoc,
  ] = await Promise.all([
    db.get(metricsLifetimeDocPath()),
    Promise.all(wtdDays.map((d) => db.get(metricsDailyDocPath(d)))),
    db.list(uniqueRecipientByPhoneCollection, { limit: 200_000 }),
    db.list(weeklyRecipientByPhoneWeekCollection, {
      where: { field: "weekKey", op: "==", value: currentWeekKey },
      limit: 200_000,
    }),
    db.get(metricsDailyDocPath(yesterdayDate)),
  ]);

  function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  const ydData = (yesterdayDoc ?? {}) as Record<string, unknown>;

  // WTD sums from daily docs.
  let apptsBookedWtd = 0;
  let activationsWtd = 0;
  for (const doc of dailyDocs) {
    apptsBookedWtd += num((doc as Record<string, unknown> | null)?.apptsBooked);
    activationsWtd += num((doc as Record<string, unknown> | null)?.activations);
  }

  const counts: DailyReportCounts = {
    textsSentWtd: wtdRecipientDocs.length,
    textsSentLifetime: lifetimeRecipientDocs.length,
    apptsBookedWtd,
    apptsBookedLifetime: num(lifetimeDoc?.apptsBooked),
    activationsWtd,
    activationsLifetime: num(lifetimeDoc?.activations),
    yesterdayDate,
    ydSmsSent: num(ydData.textsSent),
    ydCallsScheduled: num(ydData.apptsBooked),
    ydCallsAnswered: num(ydData.answered),
    ydBookings: num(ydData.activations),
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

  // Yesterday's funnel: SMS sent → calls scheduled → calls answered →
  // bookings. These count distinct event clocks (sends/bookings/calls/sales
  // all on different days), so "answered" can exceed "scheduled" on a given
  // day — that's expected, don't read it as a same-cohort funnel.
  const ydRows: Array<[string, number]> = [
    ["SMS sent", counts.ydSmsSent],
    ["Calls scheduled", counts.ydCallsScheduled],
    ["Calls answered", counts.ydCallsAnswered],
    ["Bookings", counts.ydBookings],
  ];

  const fmt = (n: number) => n.toLocaleString("en-US");

  // Shared <td> for both tables' body rows — same bottom border, with any
  // alignment/padding appended via `extra`.
  const td = (inner: string, extra = "") =>
    `<td style="border-bottom:1px solid #eee${extra}">${inner}</td>`;

  const ydHtml = `
    <h3 style="margin:0 0 4px 0;font-size:1.05rem">Yesterday</h3>
    <p style="margin:0 0 10px 0;color:#666;font-size:.8rem">${counts.yesterdayDate} ET</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:.95rem;margin-bottom:22px">
      <tbody>
        ${
    ydRows
      .map(([label, v]) =>
        `<tr>${td(label)}${td(`<b>${fmt(v)}</b>`, ";text-align:right")}</tr>`
      )
      .join("")
  }
      </tbody>
    </table>`;

  const html =
    `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;padding:24px;color:#222">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
    <p style="margin:0 0 16px 0">
      <a href="${DASHBOARD_URL}" style="color:#0a6;text-decoration:none;font-weight:600">→ Open Dashboard</a>
    </p>
    <h2 style="margin:0 0 4px 0;font-size:1.25rem">Daily morning report</h2>
    <p style="margin:0 0 18px 0;color:#666;font-size:.85rem">${reportDate} ET</p>
    ${ydHtml}
    <h3 style="margin:0 0 8px 0;font-size:1.05rem">Totals</h3>
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
          `<tr>${td(label)}${
            td(`<b>${fmt(wtd)}</b>`, ";text-align:right;padding-right:12px")
          }${td(`<b>${fmt(lt)}</b>`, ";text-align:right")}</tr>`
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
    `Yesterday — ${counts.yesterdayDate} ET`,
    ...ydRows.map(([label, v]) =>
      `${label.padEnd(20)}${String(fmt(v)).padStart(8)}`
    ),
    ``,
    `Totals`,
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
        yesterdayDate: etDayBefore(reportDate),
        ydSmsSent: 0,
        ydCallsScheduled: 0,
        ydCallsAnswered: 0,
        ydBookings: 0,
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
      `yesterday(${r.counts.yesterdayDate}) sms=${r.counts.ydSmsSent} ` +
      `scheduled=${r.counts.ydCallsScheduled} answered=${r.counts.ydCallsAnswered} ` +
      `bookings=${r.counts.ydBookings} | ` +
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
