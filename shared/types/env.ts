// Typed view of process env. Populated by shared/config/env.ts.

export interface AppEnv {
  // Firebase
  firebaseProjectId: string;
  googleApplicationCredentials: string | null;
  firebaseServiceAccountJson: string | null;

  // Bland
  blandApiKey: string;
  blandFallbackApiKey: string | null;
  blandPathwayId: string;
  blandPathwayVersion: string;

  // Cal.com
  calApiKey: string | null;

  // Postmark
  postmarkServer: string | null;

  // Quickbase
  quickbaseReportToken: string | null;
  quickbaseUserToken: string | null;
  quickbaseFailOpen: boolean;

  // ReadyMode (default + per-domain overrides resolved by readymode/auth.ts)
  rmUser: string | null;
  rmPass: string | null;

  // Throttling
  globalDailySmsCap: number;

  // Runtime
  isDeploy: boolean;
}

export type EnvKey =
  | "FIREBASE_PROJECT_ID"
  | "GOOGLE_APPLICATION_CREDENTIALS"
  | "FIREBASE_SERVICE_ACCOUNT_JSON"
  | "BLAND_API_KEY"
  | "NU_BLAND_API_KEY"
  | "BLAND_SMS_PATHWAY_ID"
  | "BLAND_PATHWAY_VERSION"
  | "CAL_API_KEY"
  | "POSTMARK_SERVER"
  | "QUICKBASE_REPORT_TOKEN"
  | "QUICKBASE_USER_TOKEN"
  | "QUICKBASE_FAIL_OPEN"
  | "RM_USER"
  | "RM_PASS"
  | "GLOBAL_DAILY_SMS_CAP";
