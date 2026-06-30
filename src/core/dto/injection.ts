export interface FutureInjection {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  isTest?: boolean;
  calendlyInviteeUri?: string;
  // Bounded-retry bookkeeping. When the sweep's dial throws, the
  // scheduledinjection is NOT consumed: `attempts` is incremented and the doc
  // is left in place so the next sweep retries it (delay-not-loss). Only after
  // MAX_INJECTION_ATTEMPTS does the sweep give up — writing a terminal
  // injectionhistory status="error" and deleting the doc. See
  // src/scheduling/domain/business/inj-sweep/mod.ts.
  attempts?: number;
  lastError?: string;
  lastAttemptAt?: string;
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
  // "skipped" = dedup guard fired: phone had a recent injectionhistory
  // entry within scheduledInjectionDedupHours, so we did NOT dial. The
  // scheduledinjection doc is deleted regardless (the dedup guard's
  // whole point is to short-circuit the dial without leaving the doc
  // around to fire again). `skipReason` carries the human-readable
  // explanation, e.g. "fired 42m ago".
  status: "success" | "error" | "skipped";
  skipReason?: string;
  callbackStatus?: number;
  isTest?: boolean;
  error?: string;
  // Number of dial attempts before this terminal record was written. Only set
  // on status="error" rows the sweep gave up on after MAX_INJECTION_ATTEMPTS.
  attempts?: number;
}
