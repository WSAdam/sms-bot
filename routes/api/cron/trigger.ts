// Manual scheduled-injection sweep. The same sweep runs automatically every
// minute on Deno Deploy via Deno.cron (see main.ts) — this route is just for
// manual firing from the Test page or curl.
//
// Both GET and POST are accepted because the legacy URL was sometimes poked
// from a browser tab.

import { define } from "@/utils.ts";
import { sweepScheduledInjections } from "@shared/services/injections/sweep.ts";

async function handle() {
  const result = await sweepScheduledInjections("manual");
  return Response.json({ success: true, ...result });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
