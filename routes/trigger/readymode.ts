// Main entry point for ReadyMode dialer webhooks.
//
// ReadyMode sends `application/x-www-form-urlencoded`, NOT JSON — that
// tripped us up for hours because the body parser only handled JSON and
// silently dropped form-encoded payloads. We now parse based on
// Content-Type, falling back to JSON for everything else.

import { define } from "@/utils.ts";
import { processInboundLead } from "@shared/services/readymode/service.ts";
import { parseTriggerPayload } from "@shared/services/readymode/validate-trigger.ts";

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

    // Validate at the boundary. Anything that fails here never reaches
    // processInboundLead, so we can't send SMS on contaminated input.
    const validation = parseTriggerPayload(merged);
    if (!validation.ok) {
      const headers: Record<string, string> = {};
      for (const [k, v] of ctx.req.headers.entries()) headers[k] = v;
      console.warn(
        `[trigger] ❌ rejected — field=${validation.error.field} reason="${validation.error.reason}" value=${JSON.stringify(validation.error.value)}\n` +
          `  url       = ${ctx.req.url}\n` +
          `  query     = ${JSON.stringify(queryObj)}\n` +
          `  rawBody   = ${rawBody.length > 0 ? rawBody : "(empty)"}\n` +
          `  parsedBody= ${JSON.stringify(body)}\n` +
          `  headers   = ${JSON.stringify(headers, null, 2)}`,
      );
      return Response.json(
        {
          status: "error",
          message: `Invalid payload: ${validation.error.field} — ${validation.error.reason}`,
          field: validation.error.field,
        },
        { status: 400 },
      );
    }

    const r = await processInboundLead(validation.dto);
    const status = r.status === "error" ? 400 : 200;
    return Response.json(r, { status });
  },
});
