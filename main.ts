import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { sweepScheduledInjections } from "@shared/services/injections/sweep.ts";
import { runDailyQbSaleMatch } from "@shared/services/sale-match/cron.ts";

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
  denoCron("scheduled-injection-sweep", "* * * * *", async () => {
    try {
      const r = await sweepScheduledInjections("cron");
      console.log(`⏰ sweep: scanned=${r.scanned} fired=${r.fired} errors=${r.errors.length}`);
    } catch (e) {
      console.error(`❌ sweep failed: ${(e as Error).message}`);
    }
  });

  // Once a day at 14:00 UTC (10am ET / 9am EDT). Pulls today's QB bookings
  // and writes saleswithin7d markers for any matched scheduled injections.
  // To change the schedule, edit the cron expression below: "min hour day mon dow"
  denoCron("daily-qb-sale-match", "0 14 * * *", async () => {
    try {
      const r = await runDailyQbSaleMatch();
      if (!r.ok) {
        console.error(`❌ daily QB cron failed: ${r.reason}`);
      } else {
        const s = r.summary!;
        console.log(
          `⏰ daily QB cron: fetched=${s.fetchedFromReport} matched=${s.matched} ` +
            `skippedNoInjection=${s.skippedNoInjection} skippedOlderThan7Days=${s.skippedOlderThan7Days}`,
        );
      }
    } catch (e) {
      console.error(`❌ daily QB cron threw: ${(e as Error).message}`);
    }
  });
}
