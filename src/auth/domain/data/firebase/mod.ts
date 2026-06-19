// Local Firebase ID token verification. This is what the Firebase Admin
// SDK does internally — no network call per request after the JWKs are
// warm. Removes the previous dependency on the Firebase Web API Key for
// SERVER-side verification (the key is still needed by the browser to
// init the Web SDK, but that's the only place now).
//
// JWK source: Google publishes Firebase's signing keys at the
// `securetoken@system.gserviceaccount.com` service-account JWK endpoint.
// They rotate roughly every 24 hours; we cache for 5 minutes.

const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const JWK_CACHE_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_SECONDS = 5 * 60;

export interface FirebaseUserInfo {
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  uid: string;
}

export interface VerifyOk {
  ok: true;
  user: FirebaseUserInfo;
}

export interface VerifyErr {
  ok: false;
  reason: string;
}

export type VerifyResult = VerifyOk | VerifyErr;

interface CachedJwks {
  fetchedAt: number;
  byKid: Record<string, JsonWebKey>;
}

let cache: CachedJwks | null = null;

async function getJwks(): Promise<Record<string, JsonWebKey>> {
  if (cache && Date.now() - cache.fetchedAt < JWK_CACHE_TTL_MS) {
    return cache.byKid;
  }
  const res = await fetch(JWK_URL);
  if (!res.ok) {
    throw new Error(`[auth] JWK fetch failed: http=${res.status}`);
  }
  const body = await res.json() as {
    keys: Array<JsonWebKey & { kid: string }>;
  };
  const byKid: Record<string, JsonWebKey> = {};
  for (const k of body.keys ?? []) {
    if (k.kid) byKid[k.kid] = k;
  }
  cache = { fetchedAt: Date.now(), byKid };
  return byKid;
}

function b64urlToBytes(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToString(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

interface IdTokenHeader {
  kid?: string;
  alg?: string;
  typ?: string;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  auth_time?: number;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
): Promise<VerifyResult> {
  if (!idToken) return { ok: false, reason: "missing-id-token" };

  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed-jwt" };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: IdTokenHeader;
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(bytesToString(b64urlToBytes(headerB64)));
    claims = JSON.parse(bytesToString(b64urlToBytes(payloadB64)));
  } catch (e) {
    return { ok: false, reason: `bad-jwt-encoding: ${(e as Error).message}` };
  }

  if (header.alg !== "RS256") {
    return { ok: false, reason: `alg-not-rs256 (got ${header.alg})` };
  }
  if (!header.kid) return { ok: false, reason: "missing-kid" };

  let jwks: Record<string, JsonWebKey>;
  try {
    jwks = await getJwks();
  } catch (e) {
    return { ok: false, reason: `jwk-fetch: ${(e as Error).message}` };
  }
  const jwk = jwks[header.kid];
  if (!jwk) {
    // Possible the keys rotated between this token's issue and our cache.
    // Force a refresh by invalidating and retrying once.
    cache = null;
    const refreshed = await getJwks().catch(() => null);
    if (!refreshed || !refreshed[header.kid!]) {
      return { ok: false, reason: `unknown-kid: ${header.kid}` };
    }
    jwks = refreshed;
  }

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwks[header.kid!],
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    b64urlToBytes(sigB64),
    signed,
  );
  if (!sigOk) return { ok: false, reason: "bad-signature" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) {
    return { ok: false, reason: "expired" };
  }
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "iat-in-future" };
  }
  if (claims.aud !== projectId) {
    return {
      ok: false,
      reason: `aud-mismatch (expected ${projectId}, got ${claims.aud})`,
    };
  }
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (claims.iss !== expectedIss) {
    return {
      ok: false,
      reason: `iss-mismatch (expected ${expectedIss}, got ${claims.iss})`,
    };
  }
  if (!claims.sub) return { ok: false, reason: "missing-sub" };
  if (!claims.email) return { ok: false, reason: "missing-email-claim" };

  return {
    ok: true,
    user: {
      email: claims.email.toLowerCase(),
      emailVerified: claims.email_verified === true,
      displayName: claims.name ?? null,
      uid: claims.sub,
    },
  };
}
