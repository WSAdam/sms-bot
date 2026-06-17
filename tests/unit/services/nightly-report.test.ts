// Covers the report's "Yesterday" four-stat block: the mapping from the
// metrics/daily counter fields to SMS sent / Calls scheduled / Calls answered
// / Bookings, that those values reach the rendered email, and the
// enabled/forceSend send-gating. See shared/services/report/nightly.ts.

import { assert, assertEquals } from "@std/assert";
import {
  cronConfigDocPath,
  metricsDailyDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  runNightlyReport,
  yesterdayEasternDateString,
} from "@shared/services/report/nightly.ts";
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

// Seed yesterday's metrics/daily counter doc with the four source fields.
function seedYesterday(
  db: FirestoreMock,
  fields: {
    textsSent: number;
    apptsBooked: number;
    answered: number;
    activations: number;
  },
) {
  db.docs.set(metricsDailyDocPath(yesterdayEasternDateString()), fields);
}

Deno.test("report maps yesterday's daily counters to the four funnel stats", async () => {
  const { db, sent } = setup();
  seedYesterday(db, {
    textsSent: 1234, // → SMS sent
    apptsBooked: 567, // → Calls scheduled
    answered: 89, // → Calls answered
    activations: 21, // → Bookings
  });

  const r = await runNightlyReport();

  assertEquals(r.counts.yesterdayDate, yesterdayEasternDateString());
  assertEquals(r.counts.ydSmsSent, 1234);
  assertEquals(r.counts.ydCallsScheduled, 567);
  assertEquals(r.counts.ydCallsAnswered, 89);
  assertEquals(r.counts.ydBookings, 21);

  // The email actually rendered with those values.
  assertEquals(sent.length, 1);
  const { HtmlBody, TextBody } = sent[0];
  assert(HtmlBody.includes("Yesterday"), "html has a Yesterday section");
  assert(HtmlBody.includes("1,234"), "html shows SMS sent");
  assert(TextBody.includes("SMS sent"), "text has the SMS sent label");
  assert(TextBody.includes("Calls scheduled"), "text has Calls scheduled");
  assert(TextBody.includes("Calls answered"), "text has Calls answered");
  assert(TextBody.includes("Bookings"), "text has Bookings");
});

Deno.test("report defaults missing daily fields to zero (cold start)", async () => {
  const { db, sent } = setup();
  // No metrics/daily doc for yesterday at all.
  const r = await runNightlyReport();
  assertEquals(r.counts.ydSmsSent, 0);
  assertEquals(r.counts.ydCallsScheduled, 0);
  assertEquals(r.counts.ydCallsAnswered, 0);
  assertEquals(r.counts.ydBookings, 0);
  assertEquals(sent.length, 1); // still sends
  // db referenced to keep the linter happy about the binding.
  assert(db.size() >= 0);
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
});
