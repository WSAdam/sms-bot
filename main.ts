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
import { getGatesConfig } from "@shared/services/config/gates-config.ts";

export const app = new App<State>();

app.use(staticFiles());

// Cross-cutting middleware (CORS, error envelope, ET access log) lives in
// routes/_middleware.ts so it runs in the file-system pipeline.

app.fsRoutes();

// ---------------------------------------------------------------------------
// Scheduled jobs (Deno Deploy only — gated on DENO_DEPLOYMENT_ID so local dev
// doesn't try to register them). Times are UTC.
//
// CRITICAL: Deno.cron MUST be called as a literal `Deno.cron(...)` expression
// for Deno Deploy's build-time scanner to find and register the cron. Previous
// versions of this file used a `denoCron` variable alias which the scanner
// missed — every cron was registered at runtime but Deploy never actually
// fired them, which is what caused the May 2026 "sweep cron silently stopped
// for 16 days" incident. See:
//   https://docs.deno.com/deploy/manual/cron
// The TS lib still ships Deno.cron under "unstable" — we silence the type
// error with a top-level declaration rather than typecasts at each call site,
// so the actual call expressions look exactly like `Deno.cron("name", ...)`.
// ---------------------------------------------------------------------------

declare global {
  namespace Deno {
    function cron(
      name: string,
      schedule: string,
      handler: () => Promise<void> | void,
    ): void;
  }
}

if (
  Deno.env.get("DENO_DEPLOYMENT_ID") && typeof Deno.cron === "function"
) {
  // Cron handler shape note: we wrap every handler as a plain `async
  // () => { try { await ... } catch { ... } }` rather than a chained
  // `() => recordCronRun(...).catch(...)`. The chained form works in
  // theory but Deno Deploy's behavior with that shape was suspect
  // around 2026-05-22 (every-minute cron was registered but never
  // logged ANY output — including its own ⏰ tick log). The plain-
  // async pattern is also easier to debug because each handler logs
  // a `[cron-tick]` line on entry so we can see in Deno Deploy logs
  // whether the handler fired at all, separately from whether the
  // marker write succeeded.

  // Every minute: fire any scheduled injections whose eventTime <= now.

  // Renamed from "scheduled-injection-sweep" 2026-05-25: Deno Deploy's
  // runtime had gotten stuck on the old name (28k errors over 30 days
  // with the handler body never being entered — same failure mode the
  // comment above describes). Renaming forces Deploy to register a fresh
  // cron under a new identifier. The old registration will decay on its
  // own once Deploy garbage-collects vanished cron names.
  Deno.cron("scheduled-injection-sweep-v2", "* * * * *", async () => {
    console.log(
      `[cron-tick] scheduled-injection-sweep-v2 ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("scheduled-injection-sweep-v2", async () => {
        // Runtime kill-switch via gatesConfig. Paused by default after
        // the 2026-05-25 near-miss; flip via /test → Gates Config form.
        const gates = await getGatesConfig();
        if (!gates.scheduledInjectionSweepEnabled) {
          console.log(`⏸  sweep paused via gatesConfig`);
          return;
        }
        const r = await sweepScheduledInjections("cron");
        console.log(
          `⏰ sweep: scanned=${r.scanned} fired=${r.fired} skipped=${r.skipped} errors=${r.errors.length}`,
        );
      });
    } catch (e) {
      console.error(`❌ sweep failed: ${(e as Error).message}`);
    }
  });

  // Once a day at 07:00 UTC = 2 AM EST (3 AM EDT). Pulls every Bland
  // conversation from the previous ET day and re-syncs each one against
  // Firestore. The reseed is safe: if Bland has fewer messages than we
  // have stored, we leave the existing docs alone.

  Deno.cron("nightly-conversation-reseed", "0 7 * * *", async () => {
    console.log(
      `[cron-tick] nightly-conversation-reseed ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("nightly-conversation-reseed", async () => {
        const { fromIso, toIso } = yesterdayEasternRange();
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
      });
    } catch (e) {
      console.error(
        `❌ nightly reseed/booking-scan threw: ${(e as Error).message}`,
      );
    }
  });

  // Once a day at 09:00 UTC = 4 AM EST (5 AM EDT during summer). Pulls
  // today's QB bookings and writes saleswithin7d markers for any matched
  // scheduled injections.

  Deno.cron("daily-qb-sale-match", "0 9 * * *", async () => {
    console.log(
      `[cron-tick] daily-qb-sale-match ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("daily-qb-sale-match", async () => {
        const r = await runDailyQbSaleMatch();
        if (!r.ok) {
          throw new Error(`daily QB cron failed: ${r.reason}`);
        }
        const s = r.summary!;
        console.log(
          `⏰ daily QB cron: fetched=${s.fetchedFromReport} matched=${s.matched} ` +
            `skippedNoInjection=${s.skippedNoInjection} skippedOlderThan7Days=${s.skippedOlderThan7Days}`,
        );
      });
    } catch (e) {
      console.error(`❌ daily QB cron threw: ${(e as Error).message}`);
    }
  });

  // Once a day at 08:15 UTC = 4:15 AM EDT (3:15 AM EST). The
  // every-minute "live-editable send time" schedule was retired
  // 2026-05-26 — it cluttered the Cron tab with 1,440 invocations/
  // day. Changing the time now requires a code change + redeploy.
  // `cronConfig.report.lastSentEtDate` is kept as an idempotency
  // belt against duplicate fires (Deno Deploy retries, manual
  // "Run Now" clicks). `cronConfig.report.timeOfDayEt` is now
  // ignored by this handler but left in the type for backward
  // compat with existing Firestore docs.

  Deno.cron("nightly-report", "15 8 * * *", async () => {
    console.log(
      `[cron-tick] nightly-report ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("nightly-report", async () => {
        const cfg = await getCronConfig();
        if (!cfg.report.enabled) {
          console.log(`⏸  nightly-report disabled via cronConfig`);
          return;
        }
        const todayEt = easternDateString(new Date());
        if (cfg.report.lastSentEtDate === todayEt) {
          console.log(`⏭  nightly-report already sent for ${todayEt}`);
          return;
        }
        const r = await runNightlyReport(todayEt);
        if (r.skipped) return;
        await setCronConfig({ report: { lastSentEtDate: todayEt } });
        console.log(
          `⏰ daily report sent: date=${r.date} ` +
            `texts wtd=${r.counts.textsSentWtd}/lt=${r.counts.textsSentLifetime} ` +
            `appts wtd=${r.counts.apptsBookedWtd}/lt=${r.counts.apptsBookedLifetime} ` +
            `acts wtd=${r.counts.activationsWtd}/lt=${r.counts.activationsLifetime}`,
        );
      });
    } catch (e) {
      console.error(`❌ nightly-report failed: ${(e as Error).message}`);
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

  Deno.cron("metrics-kvbreakdown-refresh", "0 6 * * *", async () => {
    console.log(
      `[cron-tick] metrics-kvbreakdown-refresh ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("metrics-kvbreakdown-refresh", async () => {
        const r = await refreshKvBreakdown();
        console.log(
          `⏰ kvBreakdown refresh: total=${r.total} duration=${r.durationMs}ms`,
        );
      });
    } catch (e) {
      console.error(`❌ kvBreakdown refresh threw: ${(e as Error).message}`);
    }
  });

  // Once a day at 09:30 UTC = 5:30 AM EST. Pulls yesterday's full call
  // log from the ReadyMode portal.

  Deno.cron("readymode-daily-pull", "30 9 * * *", async () => {
    console.log(
      `[cron-tick] readymode-daily-pull ${new Date().toISOString()}`,
    );
    try {
      await recordCronRun("readymode-daily-pull", async () => {
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
      });
    } catch (e) {
      console.error(`❌ readymode pull cron threw: ${(e as Error).message}`);
    }
  });
}
