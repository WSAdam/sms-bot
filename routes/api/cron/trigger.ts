// Cron sweep entry point. Gated by X-Cron-Internal-Token (matches env var
// CRON_INTERNAL_TOKEN). Deno Deploy's built-in Deno.cron self-fetches this
// with the matching header.
//
// Both GET and POST work — the legacy URL was poked from a browser sometimes.

import { define } from "@/utils.ts";
import { loadEnv } from "@shared/config/env.ts";
import { sweepScheduledInjections } from "@shared/services/injections/sweep.ts";

async function handle(ctx: { req: Request }) {
  const env = loadEnv();
  const token = ctx.req.headers.get("X-Cron-Internal-Token");
  if (env.cronInternalToken && token !== env.cronInternalToken) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await sweepScheduledInjections("cron");
  return Response.json({ success: true, ...result });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
