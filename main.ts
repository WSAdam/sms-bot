import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { sweepScheduledInjections } from "@shared/services/injections/sweep.ts";
import { scanConversationsForBookings } from "@shared/services/conversations/booking-scan.ts";
import {
  reseedConversationsByDateRange,
  yesterdayEasternRange,
} from "@shared/services/conversations/reseed.ts";
import { runNightlyReport } from "@shared/services/report/nightly.ts";
import {
  getCronConfig,
  setCronConfig,
} from "@shared/services/config/cron-config.ts";
import { runDailyQbSaleMatch } from "@shared/services/sale-match/cron.ts";
import { easternDateString } from "@shared/util/time.ts";
import { scrapeReadymode } from "@shared/services/readymode/scrape-orchestrator.ts";
import { recordCronRun } from "@shared/services/cron-health/marker.ts";
import { refreshKvBreakdown } from "@shared/services/cron-health/kv-breakdown.ts";

export const app = new App<State>();

app.use(staticFiles());

// Cross-cutting middleware (CORS, error envelope, ET access log) lives in
// routes/_middleware.ts so it runs in the file-system pipeline.

app.fsRoutes();

// ---------------------------------------------------------------------------
// Scheduled jobs (Deno Deploy only — gated on DENO_DEPLOYMENT_ID so local dev
// doesn't try to register them). Times are UTC.
//
// Deno.cron is a stable runtime API on Deno Deploy but the TS lib still ships
// it under "unstable", so we narrow it via a local typed alias.
// ---------------------------------------------------------------------------
type DenoCron = (
  name: string,
  schedule: string,
  handler: () => Promise<void> | void,
) => void;
const denoCron = (Deno as unknown as { cron?: DenoCron }).cron;

if (Deno.env.get("DENO_DEPLOYMENT_ID") && denoCron) {
  // Every minute: fire any scheduled injections whose eventTime <= now.
  denoCron(
    "scheduled-injection-sweep",
    "* * * * *",
    () =>
      recordCronRun("scheduled-injection-sweep", async () => {
        const r = await sweepScheduledInjections("cron");
        console.log(
          `⏰ sweep: scanned=${r.scanned} fired=${r.fired} errors=${r.errors.length}`,
        );
      }).catch((e) => {
        // recordCronRun re-throws so the marker captures the failure; we
        // swallow here so Deno.cron doesn't see an unhandled rejection.
        console.error(`❌ sweep failed: ${(e as Error).message}`);
      }),
  );

  // Once a day at 07:00 UTC = 2 AM EST (3 AM EDT). Pulls every Bland
  // conversation from the previous ET day and re-syncs each one against
  // Firestore. The reseed is safe: if Bland has fewer messages than we
  // have stored, we leave the existing docs alone.
  denoCron(
    "nightly-conversation-reseed",
    "0 7 * * *",
    () =>
      recordCronRun("nightly-conversation-reseed", async () => {
        const { fromIso, toIso } = yesterdayEasternRange();
        // The reseed + booking-scan share a marker — both are part of the
        // same nightly tick. If either throws, the marker captures the
        // first failure; otherwise both ran successfully.
        const r = await reseedConversationsByDateRange(fromIso, toIso);
        console.log(
          `⏰ nightly conversation reseed: bland=${r.blandConversations} ` +
            `reseeded=${r.reseeded} skipped=${r.skippedFewer} errored=${r.errored} ` +
            `delta=+${r.netMessagesAdded}`,
        );
        const s = await scanConversationsForBookings(fromIso, toIso, true);
        console.log(
          `⏰ nightly booking scan: bland=${s.blandConversations} ` +
            `proposed=${s.proposed} applied=${s.applied} ` +
            `skippedExisting=${s.skippedExisting} skippedNoTime=${s.skippedNoTime} errored=${s.errored}`,
        );
      }).catch((e) => {
        console.error(
          `❌ nightly reseed/booking-scan threw: ${(e as Error).message}`,
        );
      }),
  );

  // Once a day at 09:00 UTC = 4 AM EST (5 AM EDT during summer). Pulls
  // today's QB bookings and writes saleswithin7d markers for any matched
  // scheduled injections. To change the schedule, edit the cron expression:
  // "min hour day mon dow" — UTC time.
  denoCron(
    "daily-qb-sale-match",
    "0 9 * * *",
    () =>
      recordCronRun("daily-qb-sale-match", async () => {
        const r = await runDailyQbSaleMatch();
        if (!r.ok) {
          // Surface as a thrown error so the marker captures the failure
          // (instead of recording status=ok with a soft-fail body).
          throw new Error(`daily QB cron failed: ${r.reason}`);
        }
        const s = r.summary!;
        console.log(
          `⏰ daily QB cron: fetched=${s.fetchedFromReport} matched=${s.matched} ` +
            `skippedNoInjection=${s.skippedNoInjection} skippedOlderThan7Days=${s.skippedOlderThan7Days}`,
        );
      }).catch((e) => {
        console.error(`❌ daily QB cron threw: ${(e as Error).message}`);
      }),
  );

  // Every-minute tick. Reads cronConfig.report.timeOfDayEt + lastSentEtDate
  // to decide if it should send. This replaces the old fixed "15 9 * * *"
  // schedule so Adam can edit the send time from the dashboard without a
  // redeploy. Exactly-once-per-day is enforced by stamping
  // report.lastSentEtDate after a successful send — once a day has
  // already been sent, subsequent ticks skip even if the time still
  // matches. Subject is prefixed with [REPORT] for easy mailbox filtering.
  // Note: this cron ticks every minute but only does meaningful work
  // once per day (when target time hits + report hasn't been sent
  // today). We only stamp the cron-health marker when there's actual
  // work to log — every-minute marker writes for the "nothing to do"
  // path would be wasted I/O.
  denoCron("nightly-report", "* * * * *", async () => {
    try {
      const cfg = await getCronConfig();
      if (!cfg.report.enabled) return;

      // Current ET wall-clock HH:MM. -4 approximation matches the rest of
      // the report path; off-by-one minute around DST is acceptable since
      // the next tick will catch it.
      const now = new Date();
      const etNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const hh = String(etNow.getUTCHours()).padStart(2, "0");
      const mm = String(etNow.getUTCMinutes()).padStart(2, "0");
      const currentHhMm = `${hh}:${mm}`;
      const targetHhMm = (cfg.report.timeOfDayEt ?? "04:15").trim();
      // Once configured time has passed in current ET day, fire once.
      if (currentHhMm < targetHhMm) return;

      const todayEt = easternDateString(now);
      if (cfg.report.lastSentEtDate === todayEt) return;

      await recordCronRun("nightly-report", async () => {
        const r = await runNightlyReport(todayEt);
        if (r.skipped) return;
        await setCronConfig({ report: { lastSentEtDate: todayEt } });
        console.log(
          `⏰ daily report sent: date=${r.date} time=${currentHhMm}ET ` +
            `texts wtd=${r.counts.textsSentWtd}/lt=${r.counts.textsSentLifetime} ` +
            `appts wtd=${r.counts.apptsBookedWtd}/lt=${r.counts.apptsBookedLifetime} ` +
            `acts wtd=${r.counts.activationsWtd}/lt=${r.counts.activationsLifetime}`,
        );
      });
    } catch (e) {
      console.error(`❌ nightly report tick threw: ${(e as Error).message}`);
    }
  });

  // Once a day at 09:30 UTC = 5:30 AM EST. Pulls yesterday's full call log
  // from the ReadyMode portal (login + paginated update endpoint), writes
  // each call to calldispositions, and upserts guestanswered for any
  // non-No-Answer call. REQUIRES Adam's RM browser session to be logged
  // out at this time — RM enforces single-session-per-user.
  // Once a day at 06:00 UTC = 1 AM EST / 2 AM EDT. Re-counts every
  // container and overwrites `metrics/kvBreakdown/totals`. This is the
  // "floor" for the dashboard's kvBreakdown sidebar — even if the
  // write-site increments drift (e.g. missed instrumentation on some
  // write path), this daily refresh corrects within 24 hours.
  denoCron(
    "metrics-kvbreakdown-refresh",
    "0 6 * * *",
    () =>
      recordCronRun("metrics-kvbreakdown-refresh", async () => {
        const r = await refreshKvBreakdown();
        console.log(
          `⏰ kvBreakdown refresh: total=${r.total} duration=${r.durationMs}ms`,
        );
      }).catch((e) => {
        console.error(`❌ kvBreakdown refresh threw: ${(e as Error).message}`);
      }),
  );

  denoCron(
    "readymode-daily-pull",
    "30 9 * * *",
    () =>
      recordCronRun("readymode-daily-pull", async () => {
        const r = await scrapeReadymode();
        const errored = r.perDomain.filter((d) => d.error).length;
        console.log(
          `⏰ readymode pull: ${r.fromDate} rows=${r.totals.rowsFetched} dispositions=${r.totals.dispositionsWritten} answered=${r.totals.answeredUpserted} domainsErrored=${errored}`,
        );
        for (const d of r.perDomain) {
          if (d.error) {
            console.error(`  ❌ ${d.domain}: ${d.error}`);
          }
        }
        if (errored > 0) {
          throw new Error(`${errored} domain(s) errored — see logs`);
        }
      }).catch((e) => {
        console.error(`❌ readymode pull cron threw: ${(e as Error).message}`);
      }),
  );
}
