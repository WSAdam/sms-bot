// Login page — Firebase Web SDK + Google sign-in popup. On success the
// browser POSTs the Firebase ID token to /api/auth/session, which mints
// our own session cookie and redirects to the original destination
// (carried through the ?next= query param).
//
// Served as a plain HTML response (not a Fresh page component) because
// it's the only place we load the Firebase Web SDK and we want full
// control over the inline script.

import { define } from "@/utils.ts";
import { getAuthConfig } from "@shared/services/auth/config.ts";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(opts: {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  next: string;
  errorMessage: string | null;
}): string {
  const errorBlock = opts.errorMessage
    ? `<div class="err">${escapeHtml(opts.errorMessage)}</div>`
    : "";
  // The Firebase config we ship to the browser is PUBLIC (apiKey is a
  // project identifier, not a secret). Restriction to monsterrg.com
  // happens server-side in /api/auth/session.
  const cfg = {
    apiKey: opts.firebaseApiKey,
    authDomain: opts.firebaseAuthDomain,
    projectId: opts.firebaseProjectId,
  };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>sms-bot — sign in</title>
  <style>
    body{margin:0;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d1410;color:#e7f0eb;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#152019;border:1px solid #2a3b36;border-radius:8px;padding:32px;max-width:380px;width:90%;text-align:center}
    h1{margin:0 0 8px;font-size:20px;color:#86efac}
    p{margin:0 0 24px;color:#9ab1a5}
    button{background:#22c55e;color:#0d1410;border:0;border-radius:6px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer;width:100%}
    button:hover{background:#16a34a}
    button:disabled{opacity:.6;cursor:not-allowed}
    .err{background:#3b1818;color:#fca5a5;border:1px solid #7f1d1d;border-radius:6px;padding:12px;margin-bottom:16px;text-align:left;font-size:13px}
    .muted{font-size:12px;color:#6b8074;margin-top:24px}
  </style>
</head>
<body>
  <div class="card">
    <h1>sms-bot</h1>
    <p>Sign in to continue</p>
    ${errorBlock}
    <div id="errLive" class="err" style="display:none"></div>
    <button id="signin">Sign in with Google</button>
    <div class="muted">Restricted to monsterrg.com accounts.</div>
  </div>
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
    import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

    const app = initializeApp(${JSON.stringify(cfg)});
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const btn = document.getElementById("signin");
    const errLive = document.getElementById("errLive");

    function showErr(msg){
      errLive.textContent = msg;
      errLive.style.display = "block";
    }

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      errLive.style.display = "none";
      try {
        const result = await signInWithPopup(auth, provider);
        const idToken = await result.user.getIdToken();
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          showErr(body.error || ("Sign-in rejected (" + res.status + ")"));
          btn.disabled = false;
          return;
        }
        window.location.href = ${JSON.stringify(opts.next)};
      } catch (e) {
        showErr(String((e && e.message) || e));
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export const handler = define.handlers({
  GET(ctx) {
    const auth = getAuthConfig();
    const url = new URL(ctx.req.url);
    const next = url.searchParams.get("next") || "/dashboard";
    const errorMessage = url.searchParams.get("error");

    if (!auth.enabled) {
      return new Response(
        "Auth is not configured on this deployment. Set AUTH_FIREBASE_* and AUTH_SESSION_SECRET env vars.",
        { status: 500, headers: { "Content-Type": "text/plain" } },
      );
    }

    // Allow only relative `next` so we can't be turned into an open redirect.
    const safeNext = next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";

    return new Response(
      render({
        firebaseApiKey: auth.firebaseApiKey,
        firebaseAuthDomain: auth.firebaseAuthDomain,
        firebaseProjectId: auth.firebaseProjectId,
        next: safeNext,
        errorMessage,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  },
});
