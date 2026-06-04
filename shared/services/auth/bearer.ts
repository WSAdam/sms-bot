// Machine-to-machine bearer auth for the /canary/* monitoring endpoints.
// Canary is an external system (not a Firebase user), so it bypasses the
// session gate (see PUBLIC_PREFIXES in ./middleware.ts) and proves itself
// with a shared secret instead: `Authorization: Bearer <CANARY_SECRET>`.
//
// Fail closed: if CANARY_SECRET is unset, every request is rejected.

import { loadEnv } from "@shared/config/env.ts";

// Constant-time string compare. Mirrors the loop in ./session.ts so a
// timing side-channel can't leak the secret one byte at a time. Length
// mismatch short-circuits (the lengths themselves aren't secret).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// True iff the request carries `Authorization: Bearer <CANARY_SECRET>`.
export function verifyCanaryBearer(req: Request): boolean {
  const secret = loadEnv().canarySecret;
  if (!secret) return false; // not configured → reject everything

  const header = req.headers.get("authorization");
  if (!header) return false;

  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length).trim();
  if (!token) return false;

  return constantTimeEqual(token, secret);
}
