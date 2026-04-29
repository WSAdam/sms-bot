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
