// Manual trigger for the nightly report. Same code path the daily Deno.cron
// fires automatically at 6:15 AM ET — this route is just for ad-hoc runs from
// the dashboard. Optional ?date= overrides (default: today in ET). Optional
// ?force=1 bypasses the report.enabled kill-switch so you can test-send even
// when the cron is disabled (the manual path never stamps lastSentEtDate, so a
// forced test send won't suppress the real cron's once-a-day delivery).

import { define } from "@/utils.ts";
import { runNightlyReport } from "@shared/services/report/nightly.ts";

async function handle(ctx: { req: Request }) {
  const url = new URL(ctx.req.url);
  const date = url.searchParams.get("date") ?? undefined;
  const forceRaw = (url.searchParams.get("force") ?? "").toLowerCase();
  const forceSend = forceRaw === "1" || forceRaw === "true" ||
    forceRaw === "yes";
  const r = await runNightlyReport(date, { forceSend });
  return Response.json({ success: true, forced: forceSend, ...r });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
