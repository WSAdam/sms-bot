import {
  BLAND_DEFAULT_PATHWAY_ID,
  BLAND_DEFAULT_PATHWAY_VERSION,
} from "@shared/config/constants.ts";
import type { AppEnv, EnvKey } from "@shared/types/env.ts";

function read(key: EnvKey): string | null {
  const v = Deno.env.get(key);
  return v && v.length > 0 ? v : null;
}

function requireEnv(key: EnvKey): string {
  const v = read(key);
  if (!v) {
    throw new Error(
      `❌ Missing required env var: ${key}. ` +
        `Add it to your env file (env/local) or Deno Deploy settings.`,
    );
  }
  return v;
}

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return fallback;
}

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;

  const isDeploy = !!Deno.env.get("DENO_DEPLOYMENT_ID");
  const credPath = read("GOOGLE_APPLICATION_CREDENTIALS");
  const credJson = read("FIREBASE_SERVICE_ACCOUNT_JSON");

  if (!credPath && !credJson) {
    throw new Error(
      "❌ Need either GOOGLE_APPLICATION_CREDENTIALS (path, local) or " +
        "FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON, Deploy).",
    );
  }

  cached = {
    firebaseProjectId: requireEnv("FIREBASE_PROJECT_ID"),
    googleApplicationCredentials: credPath,
    firebaseServiceAccountJson: credJson,

    blandApiKey: requireEnv("BLAND_API_KEY"),
    blandFallbackApiKey: read("NU_BLAND_API_KEY"),
    blandPathwayId: read("BLAND_SMS_PATHWAY_ID") ?? BLAND_DEFAULT_PATHWAY_ID,
    blandPathwayVersion: read("BLAND_PATHWAY_VERSION") ??
      BLAND_DEFAULT_PATHWAY_VERSION,

    postmarkServer: read("POSTMARK_SERVER"),

    quickbaseReportToken: read("QUICKBASE_REPORT_TOKEN"),
    quickbaseUserToken: read("QUICKBASE_USER_TOKEN"),
    quickbaseFailOpen: parseBool(read("QUICKBASE_FAIL_OPEN"), true),

    rmUser: read("RM_USER"),
    rmPass: read("RM_PASS"),

    isDeploy,
  };

  if (cached.quickbaseFailOpen) {
    console.warn(
      "⚠️  QUICKBASE_FAIL_OPEN=true — DNC checks will soft-fail. " +
        "Flip to false before production cutover.",
    );
  }

  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
