// Exchange a Firebase ID token for a sms-bot session cookie. Called once
// at login by the /login page's JS after `signInWithPopup` succeeds.
//
// Verifies the ID token via the Firebase REST API, enforces the email
// domain allowlist, and writes a signed HttpOnly cookie. After this, the
// browser carries the cookie on every subsequent request and the
// middleware reads it without another network hop.

import { define } from "@/utils.ts";
import { getAuthConfig, isDomainAllowed } from "@shared/services/auth/config.ts";
import { verifyFirebaseIdToken } from "@shared/services/auth/firebase.ts";
import {
  buildClearCookie,
  buildSetCookie,
  signSession,
} from "@shared/services/auth/session.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const auth = await getAuthConfig();
    if (!auth.enabled) {
      return Response.json(
        { error: "auth-not-configured" },
        { status: 503 },
      );
    }

    const body = await ctx.req.json().catch(() => null) as
      | { idToken?: unknown }
      | null;
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken) {
      return Response.json(
        { error: "missing idToken" },
        { status: 400 },
      );
    }

    const verify = await verifyFirebaseIdToken(idToken, auth.firebaseProjectId);
    if (!verify.ok) {
      console.warn(`[auth] reject: ${verify.reason}`);
      return Response.json(
        { error: `Token verification failed: ${verify.reason}` },
        { status: 401 },
      );
    }

    if (!verify.user.emailVerified) {
      return Response.json(
        { error: "Email not verified by Google" },
        { status: 403 },
      );
    }

    if (!isDomainAllowed(verify.user.email, auth.allowedDomains)) {
      console.warn(
        `[auth] reject: domain not allowed email=${verify.user.email}`,
      );
      return Response.json(
        {
          error:
            `Sign-in restricted to ${auth.allowedDomains.join(", ")} accounts`,
        },
        { status: 403 },
      );
    }

    const exp = Math.floor(Date.now() / 1000) + auth.sessionTtlSeconds;
    const token = await signSession(
      { email: verify.user.email, exp },
      auth.sessionSecret,
    );
    const url = new URL(ctx.req.url);
    const secure = url.protocol === "https:";
    const cookie = buildSetCookie(token, auth.sessionTtlSeconds, secure);

    console.log(`[auth] ✅ signed in email=${verify.user.email}`);
    return new Response(
      JSON.stringify({ ok: true, email: verify.user.email }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie,
        },
      },
    );
  },

  DELETE(ctx) {
    // Convenience: DELETE /api/auth/session clears the cookie.
    const url = new URL(ctx.req.url);
    const secure = url.protocol === "https:";
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildClearCookie(secure),
      },
    });
  },
});
