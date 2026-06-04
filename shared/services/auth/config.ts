// Auth config. Everything except the public Firebase Web API Key is
// derived at runtime from values we already have:
//
//   firebaseProjectId    ← existing FIREBASE_PROJECT_ID
//   firebaseAuthDomain   ← derived: `${projectId}.firebaseapp.com`
//   sessionSecret        ← HMAC-SHA256 of the service-account private key
//
// If AUTH_FIREBASE_API_KEY is unset, auth is DISABLED and every route
// becomes public — same safe-default failure mode as before this collapse.
// Production MUST set AUTH_FIREBASE_API_KEY (it's safe to expose — the
// Firebase Web API key is a project identifier, not a cryptographic
// secret).

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

// Derive the session HMAC secret from the service account's private key.
// Same key across restarts → cookies survive deploys. Never written to
// disk. Bump the "v1" suffix to force a global session invalidation.
const SESSION_DERIVATION_LABEL = "sms-bot/session/v1";

let cachedServiceAccount: { private_key?: string } | null = null;

async function loadServiceAccount(): Promise<{ private_key?: string }> {
  if (cachedServiceAccount) return cachedServiceAccount;
  const env = loadEnv();
  if (env.firebaseServiceAccountJson) {
    cachedServiceAccount = JSON.parse(env.firebaseServiceAccountJson);
  } else if (env.googleApplicationCredentials) {
    cachedServiceAccount = JSON.parse(
      await Deno.readTextFile(env.googleApplicationCredentials),
    );
  } else {
    throw new Error(
      "[auth] No Firebase service account available — set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS",
    );
  }
  return cachedServiceAccount!;
}

let cachedSessionSecret: string | null = null;

async function deriveSessionSecret(): Promise<string> {
  if (cachedSessionSecret) return cachedSessionSecret;
  const sa = await loadServiceAccount();
  if (!sa.private_key) {
    throw new Error(
      "[auth] Service account JSON has no private_key field — cannot derive session secret",
    );
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(sa.private_key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(SESSION_DERIVATION_LABEL),
  );
  cachedSessionSecret = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return cachedSessionSecret;
}

let cachedConfig: AuthConfig | null = null;

export async function getAuthConfig(): Promise<AuthConfig> {
  if (cachedConfig) return cachedConfig;
  const env = loadEnv();
  const apiKey = env.authFirebaseApiKey ?? "";
  const projectId = env.firebaseProjectId; // already required by app

  // Disabled if the only required new env var is missing. Service-account
  // loading is deferred (lazy) when disabled so local dev without auth
  // doesn't pay the cost or fail on missing creds.
  if (!apiKey) {
    cachedConfig = {
      enabled: false,
      firebaseApiKey: "",
      firebaseAuthDomain: "",
      firebaseProjectId: projectId,
      sessionSecret: "",
      allowedDomains: env.authAllowedDomains,
      sessionTtlSeconds: env.authSessionTtlSeconds,
    };
    return cachedConfig;
  }

  const sessionSecret = await deriveSessionSecret();
  cachedConfig = {
    enabled: true,
    firebaseApiKey: apiKey,
    firebaseAuthDomain: `${projectId}.firebaseapp.com`,
    firebaseProjectId: projectId,
    sessionSecret,
    allowedDomains: env.authAllowedDomains,
    sessionTtlSeconds: env.authSessionTtlSeconds,
  };
  return cachedConfig;
}

export function isDomainAllowed(email: string, allowed: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.includes(domain);
}
