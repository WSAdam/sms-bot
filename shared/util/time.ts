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
