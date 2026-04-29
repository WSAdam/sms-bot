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
    const t = new Date(v).getTime();
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
