// Hardcoded values from the legacy systems. Override via env where noted.

// Bland.ai
export const BLAND_AGENT_NUMBER = "+18435488335";
export const BLAND_DEFAULT_PATHWAY_ID = "d6bd66a2-13b4-4365-a994-842c705e22b1";
export const BLAND_DEFAULT_PATHWAY_VERSION = "production";
export const BLAND_API_BASE = "https://api.bland.ai/v1/sms/conversations";

// Quickbase
export const QUICKBASE_GET_REPORTS_URL =
  "https://us-central1-crm-sdk.cloudfunctions.net/getReports";
export const QUICKBASE_BOOKINGS_TABLE_ID = "bpb28qsnn";
export const QUICKBASE_BOOKINGS_REPORT_ID = "530";

// Direct Quickbase REST API (used for reservation lookups + DNC writes).
// Hardcoded — only the user token comes from env (QUICKBASE_USER_TOKEN).
export const QUICKBASE_REALM_HOST = "monsterrg.quickbase.com";
export const QUICKBASE_API_BASE = "https://api.quickbase.com/v1";

// Reservations table + field IDs.
export const QB_RESERVATIONS_TABLE = "bmhvhc72c";
export const QB_RES_FIELD = {
  ReservationId: 3,    // record id
  EmailAddress: 78,
  GuestFullName: 79,
  Phone: 82,
  SpouseFullName: 84,
  Dnc: 457,
  AskTcpaVerbiage: 685,
} as const;

// Postmark
export const POSTMARK_FROM_ADDRESS = "notifications@monsterrg.com";
export const POSTMARK_DEFAULT_TO = "adamp@monsterrg.com";

// Throttling
export const GLOBAL_DAILY_SMS_CAP = 100;
export const RATE_LIMIT_WINDOW_DAYS = 30;
export const ATTEMPTS_GATEKEEPER_THRESHOLD = 40;

// Sale match
export const SALE_MATCH_WINDOW_DAYS = 7;

// Firestore
export const ROOT_COLLECTION = "sms-bot";

// Time
export const EASTERN_TZ = "America/New_York";
