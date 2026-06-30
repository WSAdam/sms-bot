// Near-real-time injection-failure endpoint — the signal you point an external
// canary monitor at to TEXT you the moment an injection fails for good.
//
// Returns the count + details of UNRECOVERABLE scheduled-injection failures in
// a short rolling window (default 120 min; override with ?minutes=N). Configure
// the canary with a `totalErrors lte 0` rule and a poll interval shorter than
// the window (e.g. poll every 5 min, minutes=30) so no failure slips between
// polls. Always 200 on a real reading — a non-zero count is signalled by the
// value, not the status.
//
// Why this is trustworthy: a status="error" injectionhistory doc is now written
// ONLY after the sweep exhausts its retries (MAX_INJECTION_ATTEMPTS). Transient
// blips that self-heal on the next minute's sweep never appear here, so every
// row is a real failure worth waking up for.
//
// Bearer-authenticated; bypasses the Firebase session gate via PUBLIC_PREFIXES
// (see src/auth/domain/business/middleware/mod.ts).

import { define } from "@/utils.ts";
import { verifyCanaryBearer } from "@shared/services/auth/bearer.ts";
import { gatherRecentInjectionErrors } from "@shared/services/canary/errors.ts";

const TIMEZONE = "America/New_York";
const DEFAULT_LOOKBACK_MIN = 120;
const MAX_LOOKBACK_MIN = 1440; // 24h ceiling — this is a recent-failure feed.

async function report(req: Request): Promise<Response> {
  if (!verifyCanaryBearer(req)) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const raw = Number(new URL(req.url).searchParams.get("minutes"));
  const lookbackMinutes = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.floor(raw), MAX_LOOKBACK_MIN)
    : DEFAULT_LOOKBACK_MIN;

  const r = await gatherRecentInjectionErrors(lookbackMinutes);

  return Response.json({
    ok: true,
    timezone: TIMEZONE,
    lookbackMinutes: r.lookbackMinutes,
    window: { since: r.since, until: r.until },
    totalErrors: r.totalErrors,
    errors: r.errors,
  });
}

export const handler = define.handlers({
  GET: (ctx) => report(ctx.req),
  POST: (ctx) => report(ctx.req),
});
