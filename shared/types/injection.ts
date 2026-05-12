export interface FutureInjection {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  isTest?: boolean;
  calendlyInviteeUri?: string;
}

// `firedBy` distinguishes the origin of the injection so downstream
// (sale-match, dashboard "Scheduled Call Time" column) can correctly
// classify the eventTime:
//   "cron"                  — sweep cron fired a scheduled appointment.
//                             eventTime = the future appt time. Trusted.
//   "manual"                — operator manually fired via test endpoint.
//   "talk-now"              — Bland routed a "call me now" inbound to
//                             us; we injected immediately. eventTime
//                             equals firedAt by design (the appt IS now)
//                             — NOT a placeholder.
//   "booking-scan-recovery" — nightly scan recovered a booking we missed
//                             from a Bland convo. eventTimePlaceholder
//                             marks whether the time was parseable.
//   "answered-backfill"     — legacy synthetic write from an old script.
//                             No real Bland time on record.
export interface InjectionHistoryEntry {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  firedAt: string;
  firedBy: "cron" | "manual" | "talk-now";
  status: "success" | "error";
  callbackStatus?: number;
  isTest?: boolean;
  error?: string;
}
