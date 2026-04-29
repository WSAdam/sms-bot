import { define } from "@/utils.ts";
import { EASTERN_TZ } from "@shared/config/constants.ts";

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

    let res: Response;
    try {
      res = await ctx.next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `❌ [${easternTimestamp()}] ${ctx.req.method} ${url.pathname} — ${message}`,
      );
      res = Response.json(
        { error: message },
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
