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
// Report 678 is the active sale-match feed (was 530 historically). The
// daily-qb-sale-match cron uses this as a fallback when the live-edit
// cron config doc doesn't exist or omits qbSaleMatch.reportId.
export const QUICKBASE_BOOKINGS_REPORT_ID = "678";

// Direct Quickbase REST API (used for reservation lookups + DNC writes).
// Hardcoded — only the user token comes from env (QUICKBASE_USER_TOKEN).
export const QUICKBASE_REALM_HOST = "monsterrg.quickbase.com";
export const QUICKBASE_API_BASE = "https://api.quickbase.com/v1";

// Reservations table + field IDs.
export const QB_RESERVATIONS_TABLE = "bmhvhc72c";
export const QB_RES_FIELD = {
  ReservationId: 3, // record id
  EmailAddress: 78,
  GuestFullName: 79,
  Phone: 82,
  SpouseFullName: 84,
  Dnc: 457,
  AskTcpaVerbiage: 685,
} as const;

// Cal.com
export const CAL_API_BASE = "https://api.cal.com/v2";
export const CAL_API_VERSION = "2024-08-13";
export const CAL_MONSTER_APPOINTMENTS_EVENT_TYPE_ID = 4650992;
export const CAL_DEFAULT_TIMEZONE = "America/New_York";
export const CAL_HOLDING_CAMPAIGN_ID = "ODR_APPT_HOLDING";

// ReadyMode "answered" accuracy.
// The "Appointments" campaign is where all our leads are dialed, so the answered
// metric is gated to it. This is the call-log REPORT id (an integer RM assigns
// to the report's restrict_campaign filter) — NOT the lead-inject channel code
// ("ODR - Appointments" → "cuCyA6Xoeu88" in campaigns.ts). The two are different
// ID namespaces; the report endpoint silently ignores the inject code and
// returns ALL campaigns. Verified via the campaignlist map in the call_log JSON.
export const APPOINTMENTS_CAMPAIGN_REPORT_ID = "81";
// A call counts as "answered" (a real conversation) only if it lasted at least
// this long AND its disposition isn't a No-Answer/test. RM logs short blips
// ("<30s", "<1m"), so duration alone and disposition alone are each
// insufficient — both gate.
export const ANSWERED_MIN_SECONDS = 60;
// A "No Answer" disposition that nonetheless ran at least this long is treated
// as an answered CONNECT (overriding the disposition). A No-Answer call lasting
// minutes is almost always a mis-disposition — the agent held a real
// conversation and fat-fingered the outcome. The bar is higher than
// ANSWERED_MIN_SECONDS because the disposition is actively asserting "no
// contact", so we demand stronger duration evidence (and stay clear of
// voicemail drops). Only the answered flag flips — the agent's original
// disposition string is preserved verbatim in calldispositions.
export const NO_ANSWER_ANSWERED_MIN_SECONDS = 180;

// Postmark
export const POSTMARK_FROM_ADDRESS = "notifications@monsterrg.com";
export const POSTMARK_DEFAULT_TO = "adamp@monsterrg.com";

// Throttling. GLOBAL_DAILY_SMS_CAP is the *fallback*; the live ceiling is
// loadEnv().globalDailySmsCap, which reads the GLOBAL_DAILY_SMS_CAP env var.
// Set GLOBAL_DAILY_SMS_CAP in env/local (or Deno Deploy settings) to override
// without a code change — useful for staged rollouts (e.g. =10 today, =50
// tomorrow). Falls back to this 100 if the env var is unset or invalid.
export const GLOBAL_DAILY_SMS_CAP = 100;
export const RATE_LIMIT_WINDOW_DAYS = 30;
export const ATTEMPTS_GATEKEEPER_THRESHOLD = 40;

// Sale match. 8 → 7 on 2026-05-07, then 7 → 8 on 2026-05-12 — Adam
// reverted to 8d as the canonical "what counts" threshold; boundary cases
// >8d now go to salesoutsidewindow and need a manual claim. ODR/2ND
// activator-prefix sales bypass this window regardless. The Firestore
// collection name `saleswithin7d` stays as-is for path stability — the
// constant is the source of truth. This constant is also the fallback
// default for gatesConfig.saleMatchWindowDays (live-editable from the
// dashboard) — see shared/services/config/gates-config.ts.
export const SALE_MATCH_WINDOW_DAYS = 8;

// Phones excluded from dashboard reporting. Test traffic on these numbers
// shouldn't inflate Total Texts, People Replied, Appointments Booked, etc.
// Storage breakdown counts for raw collections (audit, conversations) are
// NOT filtered — those reflect physical Firestore size. Lifetime per-phone
// counts (activated/answered/sales) DO subtract these phones.
export const EXCLUDED_REPORTING_PHONES = new Set<string>([
  "8432222986", // Adam's test phone
  "6098583137", // Edwin — Bland pathway fucked up the messageSent variable
  // for this conversation, polluting today's stats with stale
  // opener text. Excluded until the pathway template is fixed.
]);
export function isExcludedFromReporting(phone10: string): boolean {
  return EXCLUDED_REPORTING_PHONES.has(phone10);
}

// Firestore
export const ROOT_COLLECTION = "sms-bot";

// Time
export const EASTERN_TZ = "America/New_York";
