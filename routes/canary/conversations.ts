// Canary liveness endpoint — "are we still sending texts?"
//
// Returns today's outbound-send count (Eastern Time). The number is the
// existing globalsmscount/byDate counter, bumped once per outbound send in
// the lead path, so it equals "conversations we opened today". Canary watches
// `conversationsStartedToday` with a `gte <floor>` rule and pages us if it
// stalls. Always 200 on a real reading — the value, not the status code,
// signals a problem. Bearer-authenticated; bypasses the Firebase session gate
// via PUBLIC_PREFIXES (see shared/services/auth/middleware.ts).

import { define } from "@/utils.ts";
import { verifyCanaryBearer } from "@shared/services/auth/bearer.ts";
import { getCount } from "@shared/services/sms-count/service.ts";
import { easternDateString } from "@shared/util/time.ts";

const TIMEZONE = "America/New_York";

async function report(req: Request): Promise<Response> {
  if (!verifyCanaryBearer(req)) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const date = easternDateString();
  const count = await getCount(); // reads globalsmscount for today (ET)

  return Response.json({
    ok: true,
    timezone: TIMEZONE,
    date,
    conversationsStartedToday: count,
    textsSentToday: count,
  });
}

export const handler = define.handlers({
  GET: (ctx) => report(ctx.req),
  POST: (ctx) => report(ctx.req),
});
