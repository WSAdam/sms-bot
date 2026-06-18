// Covers the report's "Yesterday" four-stat block: the mapping from the
// metrics/daily counter fields to SMS sent / Calls scheduled / Calls answered
// / Bookings, that those values reach the rendered email, and the
// enabled/forceSend send-gating. See shared/services/report/nightly.ts.

import { assert, assertEquals } from "@std/assert";
import {
  cronConfigDocPath,
  metricsCronRunDocPath,
  metricsDailyDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { runNightlyReport } from "@shared/services/report/nightly.ts";
import { setPostmarkClientForTests } from "@shared/services/postmark/client.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

interface SentEmail {
  To: string;
  Subject: string;
  HtmlBody: string;
  TextBody: string;
}

function setup() {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  const sent: SentEmail[] = [];
  setPostmarkClientForTests({
    // deno-lint-ignore no-explicit-any
    sendEmail: (p: any) => {
      sent.push(p as SentEmail);
      return Promise.resolve();
    },
  });
  return { db, sent };
}

// Seed a metrics/daily counter doc for `day` with the four source fields.
function seedDaily(
  db: FirestoreMock,
  day: string,
  fields: {
    textsSent: number;
    apptsBooked: number;
    answered: number;
    activations: number;
  },
) {
  db.docs.set(metricsDailyDocPath(day), fields);
}

Deno.test("report maps yesterday's daily counters to the four funnel stats", async () => {
  const { db, sent } = setup();
  // Explicit reportDate exercises the ?date= path: "Yesterday" must be the day
  // BEFORE reportDate (derived from the date, not the wall clock).
  const REPORT_DATE = "2026-06-15";
  const YESTERDAY = "2026-06-14";
  seedDaily(db, YESTERDAY, {
    textsSent: 1234, // → SMS sent
    apptsBooked: 567, // → Calls scheduled
    answered: 89, // → Calls answered
    activations: 21, // → Bookings
  });

  const r = await runNightlyReport(REPORT_DATE);

  assertEquals(r.counts.yesterdayDate, YESTERDAY);
  assertEquals(r.counts.ydSmsSent, 1234);
  assertEquals(r.counts.ydCallsScheduled, 567);
  assertEquals(r.counts.ydCallsAnswered, 89);
  assertEquals(r.counts.ydBookings, 21);

  // The email rendered with those values. Assert the exact <b>value</b> shape —
  // bare "89"/"21" could collide with inline-style numbers (e.g. 22px), and
  // distinct values mean a label↔value transposition would fail these.
  assertEquals(sent.length, 1);
  const { HtmlBody, TextBody } = sent[0];
  assert(HtmlBody.includes("Yesterday"), "html has a Yesterday section");
  assert(HtmlBody.includes("<b>1,234</b>"), "html shows SMS sent value");
  assert(HtmlBody.includes("<b>567</b>"), "html shows Calls scheduled value");
  assert(HtmlBody.includes("<b>89</b>"), "html shows Calls answered value");
  assert(HtmlBody.includes("<b>21</b>"), "html shows Bookings value");
  assert(TextBody.includes("SMS sent"), "text has the SMS sent label");
  assert(TextBody.includes("Calls scheduled"), "text has Calls scheduled");
  assert(TextBody.includes("Calls answered"), "text has Calls answered");
  assert(TextBody.includes("Bookings"), "text has Bookings");

  // The service never stamps lastSentEtDate (only the main.ts cron does), so a
  // normal send leaves cronConfig untouched and can't suppress the real cron.
  assertEquals(db.docs.get(cronConfigDocPath()), undefined);
});

Deno.test("report defaults missing daily fields to zero (cold start)", async () => {
  const { db, sent } = setup();
  // No metrics/daily doc for yesterday at all.
  const r = await runNightlyReport();
  assertEquals(r.counts.ydSmsSent, 0);
  assertEquals(r.counts.ydCallsScheduled, 0);
  assertEquals(r.counts.ydCallsAnswered, 0);
  assertEquals(r.counts.ydBookings, 0);
  // No cron markers seeded → the answered/bookings zeros are "not collected",
  // not measured. They must report as unreliable so a 0 can't pass as fact.
  assertEquals(r.counts.ydAnsweredReliable, false);
  assertEquals(r.counts.ydBookingsReliable, false);
  assertEquals(sent.length, 1); // still sends
  // db referenced to keep the linter happy about the binding.
  assert(db.size() >= 0);
});

Deno.test("report flags yesterday stats as unverified when the feeding cron failed", async () => {
  const { db, sent } = setup();
  const REPORT_DATE = "2026-06-15";
  const YESTERDAY = "2026-06-14";
  seedDaily(db, YESTERDAY, {
    textsSent: 100,
    apptsBooked: 2,
    answered: 0, // the bogus zero a failed pull leaves behind
    activations: 0,
  });
  // ReadyMode pull errored this morning; sale-match marker absent entirely.
  db.docs.set(metricsCronRunDocPath("readymode-daily-pull"), {
    lastStatus: "error",
    lastRunAt: "2026-06-15T09:30:00.000Z",
    lastError: "1 domain(s) errored — ODR: login rejected",
  });

  const r = await runNightlyReport(REPORT_DATE);

  assertEquals(r.counts.ydAnsweredReliable, false); // pull errored
  assertEquals(r.counts.ydBookingsReliable, false); // marker missing
  const { HtmlBody, TextBody } = sent[0];
  assert(HtmlBody.includes("⚠ unverified"), "html marks the unverified rows");
  assert(
    HtmlBody.includes("ReadyMode daily pull did not complete"),
    "html carries the answered warning banner",
  );
  assert(TextBody.includes("⚠ unverified"), "text marks the unverified rows");
});

Deno.test("report marks yesterday stats verified when the feeding crons are fresh + ok", async () => {
  const { sent, db } = setup();
  const REPORT_DATE = "2026-06-15";
  const YESTERDAY = "2026-06-14";
  seedDaily(db, YESTERDAY, {
    textsSent: 100,
    apptsBooked: 2,
    answered: 7,
    activations: 1,
  });
  // Both pulls ran on the report's own ET morning and succeeded.
  db.docs.set(metricsCronRunDocPath("readymode-daily-pull"), {
    lastStatus: "ok",
    lastRunAt: "2026-06-15T09:30:00.000Z",
  });
  db.docs.set(metricsCronRunDocPath("daily-qb-sale-match"), {
    lastStatus: "ok",
    lastRunAt: "2026-06-15T09:00:00.000Z",
  });

  const r = await runNightlyReport(REPORT_DATE);

  assertEquals(r.counts.ydAnsweredReliable, true);
  assertEquals(r.counts.ydBookingsReliable, true);
  assert(
    !sent[0].HtmlBody.includes("unverified"),
    "no unverified marker when both pulls are fresh + ok",
  );
});

Deno.test("report treats a stale-but-ok pull (ran yesterday, not today) as unverified", async () => {
  const { sent, db } = setup();
  const REPORT_DATE = "2026-06-15";
  seedDaily(db, "2026-06-14", {
    textsSent: 100,
    apptsBooked: 2,
    answered: 0,
    activations: 0,
  });
  // Last successful pull was the PRIOR morning — today's never ran.
  db.docs.set(metricsCronRunDocPath("readymode-daily-pull"), {
    lastStatus: "ok",
    lastRunAt: "2026-06-14T09:30:00.000Z",
  });

  const r = await runNightlyReport(REPORT_DATE);

  assertEquals(r.counts.ydAnsweredReliable, false);
  assert(sent[0].HtmlBody.includes("⚠ unverified"));
});

Deno.test("answered reliability: a 23:30-ET-prior-day pull is NOT reliable for today (no UTC-date off-by-one)", async () => {
  const { db } = setup();
  const REPORT_DATE = "2026-06-15";
  seedDaily(db, "2026-06-14", {
    textsSent: 100,
    apptsBooked: 2,
    answered: 0,
    activations: 0,
  });
  // 03:30 UTC on 06-15 == 23:30 EDT on 06-14 → the PRIOR ET day. Must be
  // unreliable for reportDate 06-15. (Guards against a switch to UTC-date
  // comparison, which would wrongly read this as "today".)
  db.docs.set(metricsCronRunDocPath("readymode-daily-pull"), {
    lastStatus: "ok",
    lastRunAt: "2026-06-15T03:30:00.000Z",
  });
  const r = await runNightlyReport(REPORT_DATE);
  assertEquals(r.counts.ydAnsweredReliable, false);
});

Deno.test("answered reliability: a marker NEWER than a historical ?date= report is NOT flagged unverified", async () => {
  const { db } = setup();
  const REPORT_DATE = "2026-06-10"; // regenerating an old day after a backfill
  seedDaily(db, "2026-06-09", {
    textsSent: 100,
    apptsBooked: 2,
    answered: 5,
    activations: 1,
  });
  // A later ok run (06-15) is >= the old reportDate, so it clears the flag —
  // reliability here is inferred (latest-marker), not per-day verified.
  db.docs.set(metricsCronRunDocPath("readymode-daily-pull"), {
    lastStatus: "ok",
    lastRunAt: "2026-06-15T09:30:00.000Z",
  });
  const r = await runNightlyReport(REPORT_DATE);
  assertEquals(r.counts.ydAnsweredReliable, true);
});

Deno.test("report skips (no email) when report.enabled=false and not forced", async () => {
  const { db, sent } = setup();
  db.docs.set(cronConfigDocPath(), { report: { enabled: false } });
  const r = await runNightlyReport();
  assertEquals(r.skipped, true);
  assertEquals(sent.length, 0);
});

Deno.test("report forceSend bypasses the enabled=false kill-switch (backs ?force=1)", async () => {
  const { db, sent } = setup();
  db.docs.set(cronConfigDocPath(), { report: { enabled: false } });
  const r = await runNightlyReport(undefined, { forceSend: true });
  assertEquals(r.skipped, undefined);
  assertEquals(sent.length, 1);
  // A forced send must NOT stamp lastSentEtDate — the seeded cfg only had
  // { enabled: false }, so the field stays undefined. (The cron's stamping in
  // main.ts is what suppresses duplicate real fires; not covered by this test.)
  const cfg = db.docs.get(cronConfigDocPath()) as
    | { report?: Record<string, unknown> }
    | undefined;
  assertEquals(cfg?.report?.lastSentEtDate, undefined);
});
