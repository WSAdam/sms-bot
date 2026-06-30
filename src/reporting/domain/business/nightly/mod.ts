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
  metricsCronRunDocPath,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  uniqueRecipientByPhoneCollection,
  weeklyRecipientByPhoneWeekCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { getCronConfig } from "@shared/services/config/cron-config.ts";
import { sendReport } from "@reporting/domain/data/postmark/mod.ts";
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
  // Reliability of the two cron-fed yesterday stats above. false = the
  // upstream pull that populates the counter did NOT complete on this
  // report's own ET morning, so the 0 means "not collected", not "measured
  // zero". The email shows a ⚠ banner and the API JSON exposes these, so a
  // failed pull can never again masquerade as a real zero.
  ydAnsweredReliable?: boolean; // readymode-daily-pull cron fresh + ok
  ydBookingsReliable?: boolean; // daily-qb-sale-match cron fresh + ok
  // false = a textsSent counter increment failed for yesterday (a per-day
  // textsSentCounterFailedAt flag is present), so ydSmsSent's value may be
  // missing sends rather than a measured count. Mirrors ydAnsweredReliable.
  ydSmsSentReliable?: boolean;
  // WTD completeness flag. false = at least one past day in the WTD window
  // (today excluded — it's still settling) had NO metrics/daily doc, so its
  // apptsBooked/activations contributed 0 that may be "doc missing" rather
  // than "measured zero". A missing past-day doc is usually a legitimate
  // zero-activity day, so this is observability, not an error — but it
  // surfaces silent daily-metrics data loss instead of hiding it.
  wtdComplete?: boolean;
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

// The ET calendar day (YYYY-MM-DD) on which an ISO instant fell. Used to
// decide whether a cron marker's lastRunAt happened on the report's own ET
// morning. Returns null for missing/unparseable input.
function etDateOfInstant(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function build(reportDate: string): Promise<{
  html: string;
  text: string;
  counts: DailyReportCounts;
}> {
  const db = getFirestoreClient();
  // Derive the week key from reportDate, NOT the wall clock. A backfill run
  // (runNightlyReport(date) / ?date=) for a PAST date must query the WTD
  // text-recipient count for THAT date's week — using today's Monday pulled
  // the wrong week's count for any historical report.
  // Noon UTC keeps the ET wall-clock date equal to reportDate (the function
  // shifts back 4h to approximate ET; midnight-UTC would land on the previous
  // ET day at the boundary).
  const currentWeekKey = easternMondayDateString(
    new Date(`${reportDate}T12:00:00Z`),
  );
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
    pullMarker,
    saleMatchMarker,
  ] = await Promise.all([
    db.get(metricsLifetimeDocPath()),
    Promise.all(wtdDays.map((d) => db.get(metricsDailyDocPath(d)))),
    db.list(uniqueRecipientByPhoneCollection, { limit: 200_000 }),
    db.list(weeklyRecipientByPhoneWeekCollection, {
      where: { field: "weekKey", op: "==", value: currentWeekKey },
      limit: 200_000,
    }),
    db.get(metricsDailyDocPath(yesterdayDate)),
    // Cron-health markers for the two pulls that populate the yesterday
    // funnel: answered comes from the ReadyMode pull, bookings/activations
    // from the sale-match pull. We use these to flag a 0 that's really
    // "the pull failed" rather than a measured zero.
    db.get(metricsCronRunDocPath("readymode-daily-pull")),
    db.get(metricsCronRunDocPath("daily-qb-sale-match")),
  ]);

  function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  const ydData = (yesterdayDoc ?? {}) as Record<string, unknown>;

  // WTD sums from daily docs. Track completeness: a MISSING past-day doc
  // (today excluded — it's still settling at fire time) means that day
  // contributed 0 to the sums that might be "doc missing" rather than
  // "measured zero". We warn so silent daily-metrics data loss is visible
  // from the run logs instead of vanishing into the totals.
  const todayEt = easternDateString();
  let apptsBookedWtd = 0;
  let activationsWtd = 0;
  const missingWtdDays: string[] = [];
  dailyDocs.forEach((doc, i) => {
    const day = wtdDays[i];
    if (doc == null && day !== todayEt) missingWtdDays.push(day);
    apptsBookedWtd += num((doc as Record<string, unknown> | null)?.apptsBooked);
    activationsWtd += num((doc as Record<string, unknown> | null)?.activations);
  });
  const wtdComplete = missingWtdDays.length === 0;
  if (!wtdComplete) {
    console.warn(
      `[nightly] ⚠️ WTD aggregation missing metrics/daily docs for ${
        missingWtdDays.join(", ")
      } — those days contributed 0 (may be a real zero-activity day, or silent data loss)`,
    );
  }

  // A yesterday stat fed by a morning cron is trustworthy only if that cron
  // ran on THIS report's ET morning (lastRunAt >= reportDate) and succeeded.
  // A failed / missing / stale marker means the counter was never populated
  // for yesterday, so its 0 is "no data pulled", not "measured zero". (This
  // is exactly the readymode-daily-pull failure that silently produced
  // ydCallsAnswered=0.) NOTE: this is INFERRED from the single global marker,
  // not verified per-day — `lastRunAt` is "the latest pull ran/ok at some point
  // >= reportDate", not "this exact day was pulled". So a historical ?date=
  // backfill won't cry wolf (any newer ok run clears it), but it also can't
  // prove that specific old day's data was collected. Fine because we only
  // regenerate a report after triage --pull backfills that day; if that
  // changes, switch to a per-date pull record.
  // The real current ET day. A marker dated AFTER today can only come from
  // clock skew or a manual Firestore write — it must never satisfy freshness
  // (it would falsely mark yesterday's stats reliable before the cron ran).
  const currentEtDay = etDateOfInstant(new Date().toISOString());
  const cronFreshFor = (marker: Record<string, unknown> | null): boolean => {
    if (!marker || marker.lastStatus !== "ok") return false;
    const et = etDateOfInstant(marker.lastRunAt);
    if (et === null) return false;
    // Reject future-dated markers; keep the documented `>= reportDate`
    // tolerance (a newer ok run clears a stale marker for backfills) bounded
    // by "not after today".
    if (currentEtDay !== null && et > currentEtDay) return false;
    return et >= reportDate;
  };
  // A counter increment can fail (Firestore quota/network) AFTER the cron's
  // batch commit succeeded — the cron marker still reads "ok", but the
  // answered/activations number on the daily doc was never incremented. The
  // counter-write catch in import-dispositions / sale-match stamps a per-day
  // *CounterFailedAt flag on exactly that situation, so a fresh cron marker is
  // NOT sufficient to call the number reliable: the per-day flag must also be
  // absent.
  const answeredCounterFailed = typeof ydData.answeredCounterFailedAt ===
    "string";
  const activationsCounterFailed =
    typeof ydData.activationsCounterFailedAt === "string";
  const ydAnsweredReliable = cronFreshFor(
    pullMarker as Record<string, unknown> | null,
  ) && !answeredCounterFailed;
  const ydBookingsReliable = cronFreshFor(
    saleMatchMarker as Record<string, unknown> | null,
  ) && !activationsCounterFailed;
  // SMS-sent isn't fed by a morning cron (it increments live per send), so its
  // reliability hinges solely on the per-day textsSentCounterFailedAt flag the
  // outbound path stamps when an increment fails. Present → the day's textsSent
  // may undercount, so treat ydSmsSent as "possibly incomplete", not measured.
  const textsSentCounterFailed =
    typeof ydData.textsSentCounterFailedAt === "string";
  const ydSmsSentReliable = !textsSentCounterFailed;

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
    ydAnsweredReliable,
    ydBookingsReliable,
    ydSmsSentReliable,
    wtdComplete,
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
  // Each row carries a stable `id` so the ⚠-unreliable mapping below is keyed
  // off the id, NOT the display label — relabeling a row can't silently break
  // the marker.
  const ydRows: Array<{ id: string; label: string; value: number }> = [
    { id: "smsSent", label: "SMS sent", value: counts.ydSmsSent },
    {
      id: "scheduled",
      label: "Calls scheduled",
      value: counts.ydCallsScheduled,
    },
    { id: "answered", label: "Calls answered", value: counts.ydCallsAnswered },
    { id: "bookings", label: "Bookings", value: counts.ydBookings },
  ];

  // Rows whose value is "not collected" because the feeding pull failed.
  const ydUnreliable: Record<string, boolean> = {
    smsSent: !ydSmsSentReliable,
    answered: !ydAnsweredReliable,
    bookings: !ydBookingsReliable,
  };
  const warnings: string[] = [];
  if (!ydSmsSentReliable) {
    warnings.push(
      "“SMS sent” is unverified — a textsSent counter write failed yesterday, so the value may be missing sends. Treat it as possibly incomplete.",
    );
  }
  if (!ydAnsweredReliable) {
    warnings.push(
      "“Calls answered” is unverified — the ReadyMode daily pull did not complete on this report’s morning, so yesterday’s answered calls were never imported. Treat the value as “no data”, not zero.",
    );
  }
  if (!ydBookingsReliable) {
    warnings.push(
      "“Bookings” is unverified — the daily sale-match pull did not complete, so yesterday’s bookings/activations were never imported. Treat the value as “no data”, not zero.",
    );
  }

  const fmt = (n: number) => n.toLocaleString("en-US");

  // Shared <td> for both tables' body rows — same bottom border, with any
  // alignment/padding appended via `extra`.
  const td = (inner: string, extra = "") =>
    `<td style="border-bottom:1px solid #eee${extra}">${inner}</td>`;

  const warnBanner = warnings.length
    ? `<div style="background:#fff4f4;border:1px solid #f0c0c0;border-radius:6px;padding:10px 12px;margin:0 0 14px 0;font-size:.82rem;color:#900">${
      warnings.map((w) => `<div style="margin:2px 0">⚠ ${w}</div>`).join("")
    }</div>`
    : "";

  const ydHtml = `
    <h3 style="margin:0 0 4px 0;font-size:1.05rem">Yesterday</h3>
    <p style="margin:0 0 10px 0;color:#666;font-size:.8rem">${counts.yesterdayDate} ET</p>
    ${warnBanner}
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:.95rem;margin-bottom:22px">
      <tbody>
        ${
    ydRows
      .map(({ id, label, value }) => {
        const cell = ydUnreliable[id]
          ? `<b>${
            fmt(value)
          }</b> <span style="color:#c00;font-size:.8rem">⚠ unverified</span>`
          : `<b>${fmt(value)}</b>`;
        return `<tr>${td(label)}${td(cell, ";text-align:right")}</tr>`;
      })
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
    ...ydRows.map(({ id, label, value }) =>
      `${label.padEnd(20)}${String(fmt(value)).padStart(8)}${
        ydUnreliable[id] ? "  ⚠ unverified" : ""
      }`
    ),
    ...(warnings.length ? ["", ...warnings.map((w) => `⚠ ${w}`)] : []),
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
  // getCronConfig() has no internal try-catch by design: a Firestore read
  // failure here throws and is caught by the outer try-catch in main.ts's
  // nightly-report cron handler, which logs and SKIPS the report (fail-closed —
  // better to miss one morning's email than to send a report built on a
  // partially-read config). Pinned by cron-getconfig-failure-skips-report.test.
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
