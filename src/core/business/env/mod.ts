import {
  BLAND_DEFAULT_PATHWAY_ID,
  BLAND_DEFAULT_PATHWAY_VERSION,
  GLOBAL_DAILY_SMS_CAP,
} from "@core/business/constants/mod.ts";
import type { AppEnv, EnvKey } from "@core/dto/env.ts";

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

    calApiKey: read("CAL_API_KEY"),

    postmarkServer: read("POSTMARK_SERVER"),

    quickbaseReportToken: read("QUICKBASE_REPORT_TOKEN"),
    quickbaseUserToken: read("QUICKBASE_USER_TOKEN"),
    quickbaseFailOpen: parseBool(read("QUICKBASE_FAIL_OPEN"), true),

    rmUser: read("RM_USER"),
    rmPass: read("RM_PASS"),

    globalDailySmsCap: parseIntOr(
      read("GLOBAL_DAILY_SMS_CAP"),
      GLOBAL_DAILY_SMS_CAP,
    ),

    inboundWindowMode: parseInboundMode(read("INBOUND_WINDOW_MODE")),
    inboundWindowStartEt: parseHhMmOr(read("INBOUND_WINDOW_START_ET"), "00:00"),
    inboundWindowEndEt: parseHhMmOr(read("INBOUND_WINDOW_END_ET"), "23:59"),

    authFirebaseApiKey: read("AUTH_FIREBASE_API_KEY"),
    authAllowedDomains: parseDomainList(
      read("AUTH_ALLOWED_DOMAINS"),
      ["monsterrg.com"],
    ),
    authSessionTtlSeconds: parseIntOr(
      read("AUTH_SESSION_TTL_SECONDS"),
      7 * 24 * 3600,
    ),

    canarySecret: read("CANARY_SECRET"),

    isDeploy,
  };

  console.log(
    `[env] loaded: globalDailySmsCap=${cached.globalDailySmsCap}` +
      (read("GLOBAL_DAILY_SMS_CAP") ? " (from env)" : " (default)") +
      ` inboundWindowMode=${cached.inboundWindowMode}` +
      (cached.inboundWindowMode === "explicit"
        ? ` (${cached.inboundWindowStartEt}-${cached.inboundWindowEndEt})`
        : ""),
  );

  return cached;
}

function parseInboundMode(
  v: string | null,
): "off" | "none" | "explicit" | "random" {
  const s = (v ?? "").trim().toLowerCase();
  if (
    s === "random" || s === "explicit" || s === "off" || s === "none"
  ) return s;
  // Anything else (typo, junk) → "none". Default is "none" (no gate,
  // all traffic processes) so a misconfigured env never silently
  // activates the "off" kill-switch and drops every trigger.
  if (s !== "") {
    console.warn(
      `[env] ⚠️ INBOUND_WINDOW_MODE="${v}" is not one of off|none|explicit|random — falling back to "none"`,
    );
  }
  return "none";
}

function parseHhMmOr(v: string | null, fallback: string): string {
  if (v == null) return fallback;
  const s = v.trim();
  if (/^[0-2][0-9]:[0-5][0-9]$/.test(s)) return s;
  console.warn(
    `[env] ⚠️ "${v}" is not a valid HH:MM 24h string — falling back to ${fallback}`,
  );
  return fallback;
}

function parseIntOr(v: string | null, fallback: number): number {
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseDomainList(v: string | null, fallback: string[]): string[] {
  if (v == null) return fallback;
  const parts = v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

export function resetEnvForTests(): void {
  cached = null;
}
