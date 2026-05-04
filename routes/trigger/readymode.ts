// Main entry point for ReadyMode dialer webhooks.
//
// ReadyMode sends `application/x-www-form-urlencoded`, NOT JSON — that
// tripped us up for hours because the body parser only handled JSON and
// silently dropped form-encoded payloads. We now parse based on
// Content-Type, falling back to JSON for everything else.

import { define } from "@/utils.ts";
import { processInboundLead } from "@shared/services/readymode/service.ts";

function parseBody(contentType: string, raw: string): Record<string, unknown> {
  if (!raw) return {};
  const ct = contentType.toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);

    // Read the raw body BEFORE parsing so we can dump it on rejection.
    // Once consumed, .text() can't be called again, so we parse from the
    // string we already have.
    const rawBody = await ctx.req.text().catch(() => "");
    const contentType = ctx.req.headers.get("content-type") ?? "";
    const body = parseBody(contentType, rawBody);

    const queryObj: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) queryObj[k] = v;

    const merged = { ...queryObj, ...body };

    const hasPhone = !!(
      merged.phone || merged.primaryPhone || merged.Phone
    );

    if (!hasPhone) {
      // Dump EVERYTHING so we can identify the source. Headers, raw body,
      // query string, full URL — no filtering.
      const headers: Record<string, string> = {};
      for (const [k, v] of ctx.req.headers.entries()) headers[k] = v;
      console.warn(
        `[trigger] ❌ rejecting empty/no-phone request — FULL REQUEST DUMP:\n` +
          `  url       = ${ctx.req.url}\n` +
          `  method    = ${ctx.req.method}\n` +
          `  query     = ${JSON.stringify(queryObj)}\n` +
          `  rawBody   = ${rawBody.length > 0 ? rawBody : "(empty)"}\n` +
          `  parsedBody= ${JSON.stringify(body)}\n` +
          `  headers   = ${JSON.stringify(headers, null, 2)}`,
      );
      return Response.json(
        { status: "error", message: "Missing phone number" },
        { status: 400 },
      );
    }

    const r = await processInboundLead(merged);
    const status = r.status === "error" ? 400 : 200;
    return Response.json(r, { status });
  },
});
