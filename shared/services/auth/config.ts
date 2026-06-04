// Auth config derived from env. When `enabled` is false (any required
// field missing), the middleware lets every request through — handy for
// local dev without setting up Firebase. Production MUST set all four
// AUTH_FIREBASE_* + AUTH_SESSION_SECRET env vars or the dashboard will
// be wide open.

import { loadEnv } from "@shared/config/env.ts";

export interface AuthConfig {
  enabled: boolean;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  sessionSecret: string;
  allowedDomains: string[];
  sessionTtlSeconds: number;
}

export function getAuthConfig(): AuthConfig {
  const env = loadEnv();
  const enabled = !!(
    env.authFirebaseApiKey &&
    env.authFirebaseAuthDomain &&
    env.authFirebaseProjectId &&
    env.authSessionSecret
  );
  return {
    enabled,
    firebaseApiKey: env.authFirebaseApiKey ?? "",
    firebaseAuthDomain: env.authFirebaseAuthDomain ?? "",
    firebaseProjectId: env.authFirebaseProjectId ?? "",
    sessionSecret: env.authSessionSecret ?? "",
    allowedDomains: env.authAllowedDomains,
    sessionTtlSeconds: env.authSessionTtlSeconds,
  };
}

export function isDomainAllowed(email: string, allowed: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.includes(domain);
}
