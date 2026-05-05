// Manual trigger for the nightly report. Same code path the daily Deno.cron
// fires automatically at 4:15 AM EST — this route is just for ad-hoc runs
// from the dashboard. Optional ?date= overrides (default: today in ET).

import { define } from "@/utils.ts";
import { runNightlyReport } from "@shared/services/report/nightly.ts";

async function handle(ctx: { req: Request }) {
  const url = new URL(ctx.req.url);
  const date = url.searchParams.get("date") ?? undefined;
  const r = await runNightlyReport(date);
  return Response.json({ success: true, ...r });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
