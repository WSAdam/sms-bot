// Signed session cookies. Format: `<payloadB64Url>.<sigB64Url>` where the
// payload is `{email, exp}` JSON and the signature is HMAC-SHA256 over
// the payload using AUTH_SESSION_SECRET. We mint our own session instead
// of re-verifying the Firebase ID token on every request because:
//   1. Firebase ID tokens expire in 1h — would force constant refresh.
//   2. The Firebase REST verification adds a network hop per request.
//   3. The cookie carries only the email + expiry; no secret leaks.

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export const SESSION_COOKIE_NAME = "sms_bot_session";

export interface SessionPayload {
  email: string;
  exp: number; // unix seconds
}

function b64urlEncode(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(ENC.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  // Constant-time compare to avoid timing attacks.
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(DEC.decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.email !== "string" || !payload.email) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const target = `${SESSION_COOKIE_NAME}=`;
  for (const part of cookieHeader.split(/;\s*/)) {
    if (part.startsWith(target)) return part.slice(target.length);
  }
  return null;
}

export function buildSetCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  // HttpOnly so JS can't read it (XSS-resistant). SameSite=Lax so the
  // redirect-from-Firebase-popup back to our origin still carries it.
  // Secure on prod (HTTPS only); permitted off on localhost for dev.
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
