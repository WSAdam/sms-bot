// GET or POST /logout clears the session cookie and redirects to /login.

import { define } from "@/utils.ts";
import { buildClearCookie } from "@shared/services/auth/session.ts";

function handle(ctx: { req: Request }): Response {
  const url = new URL(ctx.req.url);
  const secure = url.protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/login",
      "Set-Cookie": buildClearCookie(secure),
    },
  });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
