// Guards the immediate injection-failure PUSH to Canary (texts Adam the moment
// an injection fails for good). Verifies the wire contract, the safe no-op when
// unconfigured, and that alerting can NEVER break the sweep (fail-safe).

import { assert, assertEquals } from "@std/assert";
import { pushInjectionFailure } from "@scheduling/domain/data/canary-alert/mod.ts";

const URL_KEY = "CANARY_INGEST_URL";
const TOK_KEY = "CANARY_INGEST_TOKEN";
const SECRET_KEY = "CANARY_SECRET";

function restore(key: string, prev: string | undefined) {
  if (prev === undefined) Deno.env.delete(key);
  else Deno.env.set(key, prev);
}

Deno.test("pushInjectionFailure: POSTs the failure to Canary when configured", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const prevTok = Deno.env.get(TOK_KEY);
  const origFetch = globalThis.fetch;
  const cap: { url?: string; init?: RequestInit } = {};
  Deno.env.set(URL_KEY, "https://canary.example/ingest");
  Deno.env.set(TOK_KEY, "tok-123");
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    cap.url = String(url);
    cap.init = init ?? {};
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await pushInjectionFailure({
      phone: "6142967343",
      error: "ODR injection failed: boom",
      attempts: 5,
    });
    assert(cap.url, "fetch must be called");
    assertEquals(cap.url, "https://canary.example/ingest");
    const headers = (cap.init?.headers ?? {}) as Record<string, string>;
    assertEquals(headers.authorization, "Bearer tok-123");
    const body = JSON.parse(String(cap.init?.body));
    assertEquals(body.source, "sms-bot");
    assertEquals(body.kind, "injection-failure");
    assertEquals(body.phone, "6142967343");
    assertEquals(body.attempts, 5);
    assert(typeof body.ts === "string");
    // `error` is the human SMS body — must carry the phone, raw reason, attempts.
    assert(body.error.includes("6142967343"), "summary names the phone");
    assert(
      body.error.includes("ODR injection failed: boom"),
      "summary carries the raw error",
    );
    assert(body.error.includes("5 attempts"), "summary notes attempt count");
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
    restore(TOK_KEY, prevTok);
  }
});

Deno.test("pushInjectionFailure: NO-OP (no POST) when CANARY_INGEST_URL is unset", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const origFetch = globalThis.fetch;
  Deno.env.delete(URL_KEY);
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  try {
    await pushInjectionFailure({
      phone: "5550000000",
      error: "x",
      attempts: 5,
    });
    assertEquals(called, false, "must not POST without an ingest URL");
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
  }
});

Deno.test("pushInjectionFailure: FAIL-SAFE — never throws if the POST fails", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const origFetch = globalThis.fetch;
  Deno.env.set(URL_KEY, "https://canary.example/ingest");
  globalThis.fetch =
    (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    // Must resolve, not reject — alerting can't be allowed to break the sweep.
    await pushInjectionFailure({
      phone: "5550000000",
      error: "x",
      attempts: 5,
    });
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
  }
});

Deno.test("pushInjectionFailure: token falls back to CANARY_SECRET when CANARY_INGEST_TOKEN is unset", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const prevTok = Deno.env.get(TOK_KEY);
  const prevSec = Deno.env.get(SECRET_KEY);
  const origFetch = globalThis.fetch;
  const cap: { auth?: string } = {};
  Deno.env.set(URL_KEY, "https://canary.example/ingest");
  Deno.env.delete(TOK_KEY);
  Deno.env.set(SECRET_KEY, "sec-456");
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    cap.auth = (init?.headers as Record<string, string> | undefined)
      ?.authorization;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await pushInjectionFailure({
      phone: "5550000000",
      error: "x",
      attempts: 5,
    });
    assertEquals(cap.auth, "Bearer sec-456", "falls back to CANARY_SECRET");
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
    restore(TOK_KEY, prevTok);
    restore(SECRET_KEY, prevSec);
  }
});

Deno.test("pushInjectionFailure: omits the auth header when neither token nor CANARY_SECRET is set", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const prevTok = Deno.env.get(TOK_KEY);
  const prevSec = Deno.env.get(SECRET_KEY);
  const origFetch = globalThis.fetch;
  const cap: { hasAuth?: boolean } = {};
  Deno.env.set(URL_KEY, "https://canary.example/ingest");
  Deno.env.delete(TOK_KEY);
  Deno.env.delete(SECRET_KEY);
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    cap.hasAuth = "authorization" in h;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await pushInjectionFailure({
      phone: "5550000000",
      error: "x",
      attempts: 5,
    });
    assertEquals(
      cap.hasAuth,
      false,
      "no token → the authorization key is omitted entirely (not 'Bearer ')",
    );
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
    restore(TOK_KEY, prevTok);
    restore(SECRET_KEY, prevSec);
  }
});

Deno.test("pushInjectionFailure: a non-ok HTTP response logs but does NOT throw", async () => {
  const prevUrl = Deno.env.get(URL_KEY);
  const origFetch = globalThis.fetch;
  let called = false;
  Deno.env.set(URL_KEY, "https://canary.example/ingest");
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response("nope", { status: 500 }));
  }) as typeof fetch;
  try {
    // Reaching the assert without throwing IS the guarantee: a live-but-erroring
    // Canary receiver degrades gracefully (logged) instead of breaking the sweep.
    await pushInjectionFailure({
      phone: "5550000000",
      error: "x",
      attempts: 5,
    });
    assertEquals(called, true, "the POST was attempted");
  } finally {
    globalThis.fetch = origFetch;
    restore(URL_KEY, prevUrl);
  }
});
