import { EASTERN_TZ } from "@core/business/constants/mod.ts";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: EASTERN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function easternDateString(date: Date = new Date()): string {
  return DATE_FORMATTER.format(date);
}

// 24h "HH:MM" formatter in ET. Used by the inbound trigger window gate
// (gatesConfig.inboundWindow{Start,End}Et) to lexicographically compare
// against zero-padded HH:MM strings — the lex order matches chrono
// order for that format, so no parsing or date math is needed at the
// comparison site. en-GB locale gives us 24h without AM/PM.
const TIME_HHMM_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: EASTERN_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function easternTimeHhMm(date: Date = new Date()): string {
  return TIME_HHMM_FORMATTER.format(date);
}

// ---------------------------------------------------------------------------
// Inbound trigger window math.
//
// `effectiveInboundWindow` returns today's effective gate window from
// (mode, explicitStart, explicitEnd, todayEt). null = no gate. Used by
// routes/trigger/readymode.ts to early-return outside the window.
//
// The random-mode params are hardcoded by design (per Adam's call
// 2026-05-26): start in [09:00, 16:00], window length 5h. Adjust by
// code change + redeploy. Daily randomization is deterministic from
// `todayEt` so the same window applies all day with no Firestore
// writes — and crossing midnight ET naturally produces a fresh roll.
// ---------------------------------------------------------------------------

const RANDOM_EARLIEST_START_MIN = 9 * 60; // 09:00
const RANDOM_LATEST_START_MIN = 16 * 60; // 16:00 (4pm — "before 4pm")
const RANDOM_LENGTH_MIN = 5 * 60; // 5 hours
const MAX_END_MIN = 23 * 60 + 59; // 23:59 clamp

function dayHash01(s: string): number {
  // FNV-1a 32-bit + MurmurHash3 fmix finalizer. We need GOOD distribution
  // across sequential date strings — naive djb2 produces near-identical
  // outputs for "2026-05-26", "2026-05-27", "2026-05-28", because each
  // string only differs in the last char and djb2's mixing is too linear.
  // FNV-1a's multiply step plus fmix's XOR-shift cycles spread one-char
  // input deltas across all output bits, so consecutive days land in
  // genuinely different positions of [0, 1).
  let h = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV-1a 32-bit prime
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function minutesToHhMm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function effectiveInboundWindow(
  mode: "off" | "none" | "explicit" | "random",
  explicitStartEt: string,
  explicitEndEt: string,
  todayEt: string,
): { startEt: string; endEt: string } | null {
  // Both "off" (master kill-switch, handled separately by caller) and
  // "none" (no gate) produce no window here. The trigger handler is
  // responsible for the kill-switch short-circuit BEFORE calling this.
  if (mode === "off" || mode === "none") return null;
  if (mode === "explicit") {
    return { startEt: explicitStartEt, endEt: explicitEndEt };
  }
  // mode === "random"
  const r = dayHash01(todayEt);
  const rangeMin = RANDOM_LATEST_START_MIN - RANDOM_EARLIEST_START_MIN;
  const startMin = RANDOM_EARLIEST_START_MIN + Math.floor(r * rangeMin);
  const endMin = Math.min(startMin + RANDOM_LENGTH_MIN, MAX_END_MIN);
  return {
    startEt: minutesToHhMm(startMin),
    endEt: minutesToHhMm(endMin),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Eastern-time day-boundary → UTC ISO.
//
// The dashboard/audit/appointments endpoints receive YYYY-MM-DD strings that
// the operator reads as ET calendar days. To filter Firestore docs (stored as
// UTC ISO timestamps) we need the UTC instant of ET 00:00:00 (start) or ET
// 23:59:59.999 (end) for that day.
//
// The naive approach hardcodes a "-04:00" (EDT) offset, which is WRONG for
// Nov–Mar (EST is -05:00) — every winter query lands an hour off, shifting the
// reply/booking/audit counts. This helper derives the correct offset for THAT
// SPECIFIC DATE from the IANA zone, so it's right across DST.
// ---------------------------------------------------------------------------

const ET_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TZ,
  timeZoneName: "shortOffset",
});

// Minutes to ADD to a UTC instant to express it as ET wall-clock for the given
// moment (negative — ET is behind UTC). Derived from the IANA zone so it tracks
// DST (-240 in EDT, -300 in EST).
function etOffsetMinutesAt(utcMs: number): number {
  const parts = ET_OFFSET_FORMATTER.formatToParts(new Date(utcMs));
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // shortOffset is like "GMT-4", "GMT-04:00", or "GMT".
  const m = offsetPart.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) {
    // No signed offset parsed (e.g. a future ICU/runtime emitting a bare "GMT"
    // or a localized name). Returning 0 would treat ET as UTC and mis-bucket
    // every date by 4–5h — the exact silent-skew class this file guards
    // against — so make it a loud, greppable signal instead of failing quietly.
    console.warn(
      `⚠️ [time] etOffsetMinutesAt: unparsed shortOffset '${offsetPart}' — defaulting to 0 (ET treated as UTC)`,
    );
    return 0;
  }
  // America/New_York is always a whole-hour offset (-240 EDT / -300 EST), so m[2]
  // (minutes) is always absent here; parse it straight and carry the hour's sign
  // (only matters for the half-hour zones this ET-only formatter never emits).
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + (h < 0 ? -min : min);
}

// Convert an ET calendar day (YYYY-MM-DD) + which end of the day into the
// canonical UTC ISO instant. `which === "start"` → ET 00:00:00.000;
// `which === "end"` → ET 23:59:59.999. Returns null for a falsy/blank input so
// callers can keep their `dateString ? ... : null` shape.
//
// DST-correct: we first interpret the wall-clock as if it were UTC, read the ET
// offset that applies at that moment, then subtract it to land on the real UTC
// instant. Reading the offset at the wall-clock-as-UTC point is accurate for
// day boundaries (00:00 / 23:59) because those never fall inside the DST
// transition hour for America/New_York.
export function etDayBoundaryIso(
  dateString: string | null | undefined,
  which: "start" | "end",
): string | null {
  if (!dateString) return null;
  const wall = which === "start"
    ? `${dateString}T00:00:00.000Z`
    : `${dateString}T23:59:59.999Z`;
  const asUtc = new Date(wall).getTime();
  if (!Number.isFinite(asUtc)) return null;
  const offsetMinutes = etOffsetMinutesAt(asUtc);
  // ET wall-clock = UTC + offset (offset negative). To recover real UTC from a
  // wall-clock we treated as UTC, subtract the offset.
  return new Date(asUtc - offsetMinutes * 60_000).toISOString();
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
    if (!Number.isFinite(ms)) {
      // A TZ-marked but syntactically-invalid string (e.g.
      // "2026-99-99T12:00:00Z") must NOT be passed through unchanged:
      // scheduleInjection's regex guard would accept it, the sweep's
      // "eventTime <= now()" string comparison would never match, and the
      // injection would silently never fire — losing the lead. Reject loudly.
      throw new Error(`Invalid appointment time: ${raw}`);
    }
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
// markers. DST-correct: the ET wall-clock is derived from the IANA zone's
// actual offset at each instant (etOffsetMinutesAt) rather than a hardcoded
// -4h (EDT). During EST (-5h) the old constant bucketed a marker written in
// the last ET hour of a Sunday→Monday boundary into the wrong week.
export function easternMondayDateString(date: Date = new Date()): string {
  // etOffsetMinutesAt is the (negative) minutes to ADD to a UTC instant to get
  // ET wall-clock, so UTC + offset = wall-clock.
  const etNow = new Date(
    date.getTime() + etOffsetMinutesAt(date.getTime()) * 60_000,
  );
  const dow = etNow.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(etNow);
  monday.setUTCDate(etNow.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  // `monday` is Monday 00:00 ET expressed as if it were UTC; recover the real
  // UTC instant (wall-clock − offset), then format that instant as an ET date.
  // Reading the offset at the Monday-as-UTC point is accurate because 00:00 ET
  // never falls inside the DST transition hour for America/New_York.
  const realMondayMs = monday.getTime() -
    etOffsetMinutesAt(monday.getTime()) * 60_000;
  return DATE_FORMATTER.format(new Date(realMondayMs));
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
