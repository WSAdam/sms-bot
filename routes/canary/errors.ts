// Canary errors endpoint — yesterday's hard-break errors for bug triage.
//
// Returns the count + details of persisted terminal failures from the previous
// ET day (injection errors that survived their retry, plus cron-handler
// crashes). Canary watches `totalErrors` with a `lte 0` rule; the `errors[]`
// array is the rich context a bug-fixing workflow consumes. Always 200 on a
// real reading — a non-zero count is signalled by the value, not the status.
// Bearer-authenticated; bypasses the Firebase session gate via PUBLIC_PREFIXES
// (see shared/services/auth/middleware.ts).

import { define } from "@/utils.ts";
import { verifyCanaryBearer } from "@shared/services/auth/bearer.ts";
import { gatherHardErrorsForYesterday } from "@shared/services/canary/errors.ts";

const TIMEZONE = "America/New_York";

async function report(req: Request): Promise<Response> {
  if (!verifyCanaryBearer(req)) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const r = await gatherHardErrorsForYesterday();

  return Response.json({
    ok: true,
    timezone: TIMEZONE,
    date: r.date,
    window: r.window,
    totalErrors: r.totalErrors,
    errors: r.errors,
  });
}

export const handler = define.handlers({
  GET: (ctx) => report(ctx.req),
  POST: (ctx) => report(ctx.req),
});
