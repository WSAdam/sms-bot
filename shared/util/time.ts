import { EASTERN_TZ } from "@shared/config/constants.ts";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: EASTERN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function easternDateString(date: Date = new Date()): string {
  return DATE_FORMATTER.format(date);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Stamp a customer-agreed appointment time with an explicit timezone so
// the sweep doesn't fire 4 hours early. Background: Bland's pathway has
// historically sent `startTime: "2026-05-19T12:00:00"` (no Z, no
// ±HH:MM) representing the customer's local time. `new Date(...)` on a
// TZ-naive ISO string interprets it as UTC, so "12 pm" the customer
// said becomes 12 pm UTC = 8 am EDT in our storage — and that's when
// the sweep dials. Customer was unreachable, sale lost.
//
// Inputs we tolerate:
//   - "2026-05-19T12:00:00Z"          — explicit UTC, already correct
//   - "2026-05-19T12:00:00-04:00"     — explicit offset, already correct
//   - "2026-05-19T12:00:00"           — TZ-naive; we apply the supplied
//                                       timezone (or default to ET)
//
// Output is always a canonical UTC ISO string (toISOString) so every
// downstream reader interprets it identically — no string-format
// ambiguity, no JS "is local or UTC" coin-flip.
export function normalizeAppointmentTime(
  raw: string,
  tz: string | undefined,
): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const hasTzMarker = /Z$/.test(trimmed) ||
    /[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (hasTzMarker) {
    // Already unambiguous — just canonicalize to UTC ISO.
    const ms = new Date(trimmed).getTime();
    if (!Number.isFinite(ms)) return trimmed;
    return new Date(ms).toISOString();
  }
  // TZ-naive — interpret as the customer's local wall-clock in `tz`
  // (default ET, the operational base time zone for this bot).
  const tzName = tz && tz.length > 0 ? tz : EASTERN_TZ;
  // Use the formatToParts approach: compute what UTC offset applies in
  // `tzName` AT the given wall-clock moment, then subtract that offset
  // to get the correct UTC ms. Handles DST transitions correctly.
  const naive = new Date(`${trimmed}Z`); // treat as UTC first
  if (!Number.isFinite(naive.getTime())) return trimmed;
  // Find the offset the target tz applies at this wall-clock moment.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzName,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(naive);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // shortOffset is like "GMT-4" or "GMT-04:00" or "GMT". Parse hours.
  const m = offsetPart.match(/GMT([+-]\d+)(?::(\d{2}))?/);
  let offsetMinutes = 0;
  if (m) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) * Math.sign(h || 1) : 0;
    offsetMinutes = h * 60 + min;
  }
  // Subtract the tz's offset from the wall-clock-as-UTC interpretation
  // to land on actual UTC. (Eastern is -4 in EDT, so 12 pm ET wall =
  // 12 pm UTC interpretation minus -4h = 4 pm UTC.)
  const realMs = naive.getTime() - offsetMinutes * 60_000;
  return new Date(realMs).toISOString();
}

// ISO date (YYYY-MM-DD) of the Monday 00:00 ET that begins the week
// containing `date`. Used as the partition key for weekly recipient
// markers. Approximated using -4h (EDT) — off by an hour around DST
// transitions, which only matters for events fired in the 1-hour DST
// drift; benign for week-bucketing reporting.
export function easternMondayDateString(date: Date = new Date()): string {
  const etNow = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const dow = etNow.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(etNow);
  monday.setUTCDate(etNow.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  // Shift back to "wall clock" by formatting via the same Eastern formatter.
  // monday represents Monday 00:00 ET expressed in UTC; re-encode as ET date.
  return DATE_FORMATTER.format(new Date(monday.getTime() + 4 * 60 * 60 * 1000));
}

// IANA timezone → approximate UTC offset (hours). Used to interpret
// naive Bland Desired_Time strings (no offset) as local time in the
// guest's zone. Approximate at DST boundaries — callers should pair
// this with a wide sanity window.
const TZ_OFFSET_HOURS: Record<string, number> = {
  "America/New_York": -4,
  "America/Chicago": -5,
  "America/Denver": -6,
  "America/Phoenix": -7,
  "America/Los_Angeles": -7,
  "America/Anchorage": -8,
  "Pacific/Honolulu": -10,
};

// Parses a Bland `variables.Desired_Time` string. Strings with an
// explicit offset or trailing Z parse directly. Naive strings are
// interpreted in the supplied IANA timezone (falls back to UTC if the
// zone is unknown).
export function parseBlandDesiredTimeMs(
  raw: string,
  conversationTz?: string,
): number | null {
  if (!raw) return null;
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(raw)) {
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(raw + "Z").getTime();
  if (!Number.isFinite(ms)) return null;
  const offsetHours = conversationTz
    ? (TZ_OFFSET_HOURS[conversationTz] ?? 0)
    : 0;
  return ms - offsetHours * 3_600_000;
}

export function parseDateishToMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Bare YYYY-MM-DD (e.g. "2026-05-04" from QB report 678) parses as
    // midnight UTC by default — that's 8pm ET the *previous day*. For
    // calendar-day semantics we anchor it to noon UTC instead, which is
    // mid-morning ET regardless of DST and lands on the right calendar day
    // when fed through easternDateString.
    const adjusted = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v;
    const t = new Date(adjusted).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function isWithinWindowAfter(
  earlierMs: number,
  laterMs: number,
  windowDays: number,
): boolean {
  if (laterMs < earlierMs) return false;
  return (laterMs - earlierMs) <= windowDays * 24 * 60 * 60 * 1000;
}

export function daysBetween(earlierMs: number, laterMs: number): number {
  return (laterMs - earlierMs) / (24 * 60 * 60 * 1000);
}

// Day-level window check: extracts the ET calendar day from each timestamp,
// then asks "is the later day within `windowDays` after the earlier day?"
// This avoids same-day false-rejects: an appointment at "2026-04-09 17:15 ET"
// is the same calendar day as a sale dated "2026-04-09" (which JS parses as
// midnight UTC = 8pm ET *April 8*) — at the millisecond level that's
// negative diff and would fail isWithinWindowAfter, but at the day level it
// is a 0-day-apart match.
export function dayDiff(earlierMs: number, laterMs: number): number {
  const earlier = easternDateString(new Date(earlierMs));
  const later = easternDateString(new Date(laterMs));
  // Parse both as UTC midnight; identical timezone so the diff is pure days.
  const a = new Date(`${earlier}T00:00:00Z`).getTime();
  const b = new Date(`${later}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export function isWithinDayWindow(
  earlierMs: number,
  laterMs: number,
  windowDays: number,
): boolean {
  const d = dayDiff(earlierMs, laterMs);
  return d >= 0 && d <= windowDays;
}
