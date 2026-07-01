// Guards resolveNearestWeekday — the "assume the nearest upcoming weekday" rule
// for locked-in bookings whose customer named only a weekday (e.g. "Friday after
// 3pm") with no full calendar date. Returns a TZ-naive ET wall-clock ISO; the
// scan runs it through normalizeAppointmentTime for a DST-correct UTC instant.

import { assert, assertEquals } from "@std/assert";
import { resolveNearestWeekday } from "@messaging/domain/business/booking-scan/mod.ts";
import { normalizeAppointmentTime } from "@shared/util/time.ts";
import {
  conversationDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { scanConversationsForBookings } from "@shared/services/conversations/booking-scan.ts";
import { conversationDocId } from "@shared/util/id.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// 2026-07-01T16:00:00Z = Wed Jul 1 2026, 12:00 EDT (noon ET, summer).
const WED_NOON_ET = new Date("2026-07-01T16:00:00Z");

Deno.test("resolveNearestWeekday: 'Friday after 3:00pm' from a Wednesday → this Friday 3pm ET (DST-correct)", () => {
  const naive = resolveNearestWeekday(
    "So Friday after 3:00pm works best?",
    WED_NOON_ET,
  );
  assertEquals(naive, "2026-07-03T15:00:00");
  // EDT (−04:00) in July → 19:00Z.
  assertEquals(
    normalizeAppointmentTime(naive!, undefined),
    "2026-07-03T19:00:00.000Z",
  );
});

Deno.test("resolveNearestWeekday: nearest upcoming per weekday; noon default when no time", () => {
  // From Wed Jul 1 2026 (dow=3):
  assertEquals(
    resolveNearestWeekday("thursday", WED_NOON_ET),
    "2026-07-02T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("friday", WED_NOON_ET),
    "2026-07-03T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("saturday", WED_NOON_ET),
    "2026-07-04T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("sunday", WED_NOON_ET),
    "2026-07-05T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("monday", WED_NOON_ET),
    "2026-07-06T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("tuesday", WED_NOON_ET),
    "2026-07-07T12:00:00",
  );
  // "wednesday" is today at noon; the default-noon instant == now (not strictly
  // future) → rolls to next Wednesday.
  assertEquals(
    resolveNearestWeekday("wednesday", WED_NOON_ET),
    "2026-07-08T12:00:00",
  );
});

Deno.test("resolveNearestWeekday: abbreviations + explicit times parse", () => {
  assertEquals(
    resolveNearestWeekday("fri at 4pm", WED_NOON_ET),
    "2026-07-03T16:00:00",
  );
  assertEquals(
    resolveNearestWeekday("monday 9:30 am", WED_NOON_ET),
    "2026-07-06T09:30:00",
  );
  assertEquals(
    resolveNearestWeekday("tues noon", WED_NOON_ET),
    "2026-07-07T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("thurs at midnight", WED_NOON_ET),
    "2026-07-02T00:00:00",
  );
});

Deno.test("resolveNearestWeekday: same weekday — today when the time is ahead, next week when past", () => {
  // Fri Jul 3 2026, 10:00 EDT = 14:00Z — "Friday 3pm" is still ahead today.
  assertEquals(
    resolveNearestWeekday("friday 3pm", new Date("2026-07-03T14:00:00Z")),
    "2026-07-03T15:00:00",
  );
  // Fri Jul 3 2026, 8:00 PM EDT = next day 00:00Z — "Friday 3pm" already passed.
  assertEquals(
    resolveNearestWeekday("friday 3pm", new Date("2026-07-04T00:00:00Z")),
    "2026-07-10T15:00:00",
  );
});

Deno.test("resolveNearestWeekday: DST-correct — a winter Friday resolves to EST (−05:00)", () => {
  // Wed Jan 7 2026, 12:00 EST = 17:00Z.
  const naive = resolveNearestWeekday(
    "friday 3pm",
    new Date("2026-01-07T17:00:00Z"),
  );
  assertEquals(naive, "2026-01-09T15:00:00");
  // EST (−05:00) → 20:00Z (vs summer's 19:00Z) — proves DST is applied per-date.
  assertEquals(
    normalizeAppointmentTime(naive!, undefined),
    "2026-01-09T20:00:00.000Z",
  );
});

Deno.test("resolveNearestWeekday: no weekday token → null (falls to placeholder path)", () => {
  assertEquals(
    resolveNearestWeekday("let's do 3pm sometime", WED_NOON_ET),
    null,
  );
  // The bare "sat"/"sun" false-positive guard: casual words don't match.
  assertEquals(
    resolveNearestWeekday("I sat in the sun all day", WED_NOON_ET),
    null,
  );
});

Deno.test("resolveNearestWeekday: collision-prone abbreviations don't false-match casual English", () => {
  // "wed" (married), "thu" (filler), "mon" (inside c'mon) are NOT weekday tokens.
  assertEquals(resolveNearestWeekday("we wed in june", WED_NOON_ET), null);
  assertEquals(
    resolveNearestWeekday("they got wed last summer", WED_NOON_ET),
    null,
  );
  assertEquals(resolveNearestWeekday("thu... let me think", WED_NOON_ET), null);
  // …and because "c'mon" no longer matches Monday, a REAL day in the same
  // message still resolves (no false ambiguity):
  assertEquals(
    resolveNearestWeekday("c'mon let's do friday", WED_NOON_ET),
    "2026-07-03T12:00:00",
  );
});

Deno.test("resolveNearestWeekday: ambiguous multi-day text → null (don't guess the wrong day)", () => {
  assertEquals(
    resolveNearestWeekday("not Monday, let's do Friday", WED_NOON_ET),
    null,
  );
  assertEquals(
    resolveNearestWeekday("Tuesday or Wednesday?", WED_NOON_ET),
    null,
  );
  // The SAME day repeated is not ambiguous — still resolves.
  assertEquals(
    resolveNearestWeekday("Friday works, yeah Friday", WED_NOON_ET),
    "2026-07-03T12:00:00",
  );
  // 3+ mentions with a repeat: distinct days {Mon,Fri} still > 1 → null (proves
  // the Set counts resolved day-numbers, not raw token count).
  assertEquals(
    resolveNearestWeekday("Monday or Friday, or Monday again", WED_NOON_ET),
    null,
  );
});

Deno.test("resolveNearestWeekday: 'next'/'following' rolls to the week AFTER the nearest", () => {
  // From Wed Jul 1: plain Friday = Jul 3; "next Friday" = Jul 10 (not a week early).
  assertEquals(
    resolveNearestWeekday("friday", WED_NOON_ET),
    "2026-07-03T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("next Friday", WED_NOON_ET),
    "2026-07-10T12:00:00",
  );
  assertEquals(
    resolveNearestWeekday("the following Friday at 3pm", WED_NOON_ET),
    "2026-07-10T15:00:00",
  );
});

Deno.test("resolveNearestWeekday: bare 24h time (>=13:00) parses; ambiguous low hour → noon default", () => {
  assertEquals(
    resolveNearestWeekday("Friday at 15:00", WED_NOON_ET),
    "2026-07-03T15:00:00",
  );
  assertEquals(
    resolveNearestWeekday("friday at 20:30", WED_NOON_ET),
    "2026-07-03T20:30:00",
  );
  // Ambiguous "3:30" (no am/pm) is NOT read as 03:30 — stays the noon default.
  assertEquals(
    resolveNearestWeekday("friday at 3:30", WED_NOON_ET),
    "2026-07-03T12:00:00",
  );
});

Deno.test("booking-scan: a locked-in booking with only a weekday DIALS (schedules the nearest Friday), not a no-time placeholder", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5559990001";
    const callId = "conv-weekday-1";
    const seed = (sender: "Guest" | "AI Bot", message: string, ts: string) =>
      mock.docs.set(
        conversationDocPath(conversationDocId(phone, callId, ts)),
        { phoneNumber: phone, callId, timestamp: ts, sender, message },
      );
    // Negotiation names a weekday + time but NO calendar date; then "locked in".
    seed(
      "AI Bot",
      "So Friday after 3:00pm works best?",
      "2026-06-30T18:31:29.000Z",
    );
    seed("Guest", "Eastern, I live in Michigan", "2026-06-30T18:32:08.000Z");
    seed(
      "AI Bot",
      "You're locked in! A specialist will ring you then.",
      "2026-06-30T18:32:11.000Z",
    );

    const origLog = console.log;
    const logs: string[] = [];
    console.log = ((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    }) as typeof console.log;
    try {
      await scanConversationsForBookings(
        "2026-06-01T00:00:00.000Z",
        "2026-07-31T23:59:59.999Z",
        true, // apply
      );
    } finally {
      console.log = origLog;
    }

    // The assumed-weekday time is tagged in the schedule log as [weekday:bot]
    // (the "Friday after 3pm" line is from AI Bot, reached by the backward scan)
    // so an ASSUMED time is greppable/auditable vs a Bland/parsed exact time.
    assert(
      logs.some((l) => l.includes("src=[weekday:bot]")),
      "schedule log must tag the assumed-weekday source as [weekday:bot]",
    );

    const doc = await mock.get(scheduledInjectionDocPath(phone)) as
      | { eventTime?: string }
      | null;
    assert(
      doc?.eventTime,
      "a scheduledinjection must be created (dials) — not a no-time placeholder",
    );
    const when = new Date(doc!.eventTime!);
    assert(when.getTime() > Date.now(), "eventTime must be in the future");
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        hour12: false,
      }).formatToParts(when).map((p) => [p.type, p.value]),
    );
    assertEquals(parts.weekday, "Fri", "nearest upcoming Friday");
    assertEquals(parts.hour, "15", "3pm ET");
  } finally {
    setFirestoreClientForTests(null);
  }
});
