import { define } from "@/utils.ts";
import { EASTERN_TZ } from "@shared/config/constants.ts";
import { authGate } from "@shared/services/auth/middleware.ts";

const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Cron-Secret",
  "X-Cron-Internal-Token",
].join(", ");

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

function easternTimestamp(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: EASTERN_TZ,
    hour12: false,
  });
}

function applyCors(headers: Headers): void {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
}

export const handler = [
  define.middleware(async (ctx) => {
    const start = performance.now();
    const url = new URL(ctx.req.url);

    if (ctx.req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      applyCors(res.headers);
      return res;
    }

    // Auth gate. Runs after the OPTIONS short-circuit (so preflight stays
    // open) but BEFORE the route handler. Returns a Response when the
    // request is unauthenticated; null when auth is disabled, the path
    // is public, or the session is valid.
    const blocked = await authGate(ctx.req);
    if (blocked) {
      applyCors(blocked.headers);
      const ms = Math.round(performance.now() - start);
      console.log(
        `🔐 [${easternTimestamp()}] ${ctx.req.method} ${url.pathname} → ${blocked.status} (${ms}ms, auth)`,
      );
      return blocked;
    }

    let res: Response;
    try {
      res = await ctx.next();
    } catch (err) {
      // Capture EVERYTHING we can — Error.message is empty for some
      // throws (e.g. `throw new Error()` or non-Error throws), and a
      // blank "error": "" body is useless for debugging from the
      // client. Fall back through name → stack → JSON.stringify so
      // there's always something to act on.
      const errAsError = err instanceof Error ? err : null;
      const message = errAsError?.message ||
        errAsError?.name ||
        (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();
      const stack = errAsError?.stack;
      console.error(
        `❌ [${easternTimestamp()}] ${ctx.req.method} ${url.pathname} — ${message}` +
          (stack ? `\n${stack}` : ""),
      );
      res = Response.json(
        {
          error: message,
          name: errAsError?.name,
          // Truncate stack so we don't ship a 10kb response body for
          // run-of-the-mill failures.
          stack: stack ? stack.split("\n").slice(0, 8).join("\n") : undefined,
        },
        { status: 500 },
      );
    }

    applyCors(res.headers);

    const ms = Math.round(performance.now() - start);
    console.log(
      `🔍 [${easternTimestamp()}] ${ctx.req.method} ${url.pathname} → ${res.status} (${ms}ms)`,
    );
    return res;
  }),
];
