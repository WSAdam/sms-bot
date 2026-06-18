// Covers the reactive single-session takeover in shared/services/readymode/
// portal-client.ts `login()`: on RM's 200 "already logged in" interstitial, it
// must re-POST the SAME creds + `logout_other_sessions=on` — but ONLY when
// takeoverIfLoggedIn is set, and NEVER on the first POST (that path 500s).
//
// Mocks global fetch with a scripted response queue and inspects every call.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { login } from "@shared/services/readymode/portal-client.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

function res(
  status: number,
  body: string,
  setCookies: string[] = [],
): Response {
  const headers = new Headers();
  for (const c of setCookies) headers.append("set-cookie", c);
  const nullBody = status === 204 || (status >= 300 && status < 400);
  return new Response(nullBody ? null : body, { status, headers });
}

interface Call {
  url: string;
  method: string;
  body: string;
}

// Swap globalThis.fetch with a queue-driven mock; returns the recorded calls
// and a restore fn.
function mockFetch(queue: Response[]): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: queue empty");
    return Promise.resolve(next);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

const SEED = () =>
  res(200, "<html>login</html>", ["PHPSESSID=seed1; Path=/", "seH=1.2.3.4"]);
// Factory (not a shared value): a Response body is single-read, so each test
// needs a fresh one.
const INTERSTITIAL = () =>
  res(
    200,
    '<span id="login_fail" style="color:red;"><p>AlexA is already logged in!</p></span>',
  );
const TAKEOVER_OK = () =>
  res(302, "", [
    "PHPSESSID=new2; Path=/",
    "saved_account=AlexA; Path=/",
    "sp=zzz",
    "stationId=3038",
  ]);

Deno.test("login() takeover: re-POSTs logout_other_sessions ONLY on the 2nd POST", async () => {
  const { calls, restore } = mockFetch([SEED(), INTERSTITIAL(), TAKEOVER_OK()]);
  try {
    const session = await login(DialerDomain.ODR, "AlexA", "pw", {
      takeoverIfLoggedIn: true,
    });
    const posts = calls.filter((c) =>
      c.method === "POST" && c.url.includes("/login_new/")
    );
    assertEquals(posts.length, 2, "expected exactly two login POSTs");
    assert(
      !posts[0].body.includes("logout_other_sessions"),
      "first POST must NOT carry the takeover flag (it 500s)",
    );
    assert(
      posts[1].body.includes("logout_other_sessions=on"),
      "takeover POST must carry logout_other_sessions=on",
    );
    assert(
      session.cookieHeader.includes("saved_account=AlexA"),
      "session reflects the post-takeover saved_account",
    );
  } finally {
    restore();
  }
});

Deno.test("login() does NOT take over when the flag is unset (only one POST, then rejects)", async () => {
  const { calls, restore } = mockFetch([SEED(), INTERSTITIAL()]);
  try {
    await assertRejects(
      () => login(DialerDomain.ODR, "AlexA", "pw"), // no takeover opt
      Error,
      "already logged in",
    );
    const posts = calls.filter((c) =>
      c.method === "POST" && c.url.includes("/login_new/")
    );
    assertEquals(
      posts.length,
      1,
      "must not fire a second POST without the opt",
    );
  } finally {
    restore();
  }
});

Deno.test("login() does NOT take over on a non-interstitial login_fail (e.g. bad creds), even with the flag", async () => {
  const badCreds = res(
    200,
    '<span id="login_fail" style="color:red;"><p>Bad account information.</p></span>',
  );
  const { calls, restore } = mockFetch([SEED(), badCreds]);
  try {
    await assertRejects(
      () =>
        login(DialerDomain.ODR, "AlexA", "pw", { takeoverIfLoggedIn: true }),
      Error,
      "Bad account information",
    );
    const posts = calls.filter((c) =>
      c.method === "POST" && c.url.includes("/login_new/")
    );
    assertEquals(posts.length, 1, "bad-creds fail must not trigger a takeover");
  } finally {
    restore();
  }
});
