// Auth gate. Runs at the front of the middleware chain in
// routes/_middleware.ts. If the session cookie is missing/invalid:
//   - UI requests (Accept: text/html) → 302 redirect to /login?next=<path>
//   - API/other requests → 401 JSON
//
// Public paths bypass entirely. Public = anything an EXTERNAL system
// hits without a session: webhooks from ReadyMode / Bland / Cal.com,
// the healthz uptime probe, and the auth flow itself. Update this list
// only when you add a new endpoint that an external system hits
// directly without a session.

import { readSessionCookie, verifySession } from "./session.ts";
import { getAuthConfig } from "./config.ts";

const PUBLIC_PREFIXES = [
  "/login",
  "/logout",
  "/api/auth/",
  "/trigger/", // ReadyMode → us
  "/sms-callback/", // Bland → us
  "/cal/", // Cal.com → us
  "/sms-flow/", // queue triggers from external systems
  "/healthz",
];

const PUBLIC_EXACT = new Set<string>([
  "/favicon.ico",
]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function wantsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

export async function authGate(req: Request): Promise<Response | null> {
  const auth = await getAuthConfig();
  // If auth is disabled (AUTH_FIREBASE_API_KEY missing), let every
  // request through. This keeps local dev frictionless and is the SAME
  // failure mode as before this feature shipped, so an env misconfig
  // never accidentally locks out the dashboard — but production MUST
  // set AUTH_FIREBASE_API_KEY.
  if (!auth.enabled) return null;

  const url = new URL(req.url);
  if (isPublicPath(url.pathname)) return null;

  const cookie = readSessionCookie(req.headers.get("cookie"));
  if (cookie) {
    const session = await verifySession(cookie, auth.sessionSecret);
    if (session) {
      // Authenticated — let the chain continue.
      return null;
    }
  }

  // Unauthenticated.
  if (wantsHtml(req)) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?next=${next}` },
    });
  }
  return Response.json(
    { error: "unauthenticated" },
    { status: 401 },
  );
}
