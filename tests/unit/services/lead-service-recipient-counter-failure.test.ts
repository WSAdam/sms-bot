// Guards the textsSent counter-failure observability on the outbound path.
// recordOutboundRecipientMarkers increments the daily/lifetime textsSent
// counters fire-and-forget. If that increment fails (quota/network) the day
// looks identical to a true zero-texts day in the nightly report. The fix
// mirrors the apptsBooked/activations *CounterFailedAt pattern: on failure we
// stamp textsSentCounterFailedAt on metrics/daily/{day} (and re-throw so the
// caller logs); on a clean write we clear the flag. The nightly report reads
// the flag and demotes ydSmsSentReliable.

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  metricsDailyDocPath,
  metricsLifetimeDocPath,
} from "@shared/firestore/paths.ts";
import { _recordOutboundRecipientMarkersForTest } from "@dialer/domain/business/lead-service/mod.ts";
import { runNightlyReport } from "@reporting/domain/business/nightly/mod.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { setPostmarkClientForTests } from "@shared/services/postmark/client.ts";
import { easternDateString } from "@shared/util/time.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// Mirror nightly-report.test.ts's harness: a fixed reportDate avoids clock
// dependence and a Postmark stub keeps the send offline.
function nightlySetup() {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  setPostmarkClientForTests({
    // deno-lint-ignore no-explicit-any
    sendEmail: (_p: any) => Promise.resolve(),
  });
  return db;
}

Deno.test("recordOutboundRecipientMarkers: a textsSent increment failure stamps textsSentCounterFailedAt and re-throws", async () => {
  const mock = new FirestoreMock();
  // Make the daily/lifetime counter increment fail the way a quota blip would.
  const origIncrement = mock.incrementField.bind(mock);
  mock.incrementField = (path, fields) => {
    if (typeof fields.textsSent === "number") {
      return Promise.reject(new Error("RESOURCE_EXHAUSTED: quota"));
    }
    return origIncrement(path, fields);
  };
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551239100";
    // The function must re-throw so the fire-and-forget caller logs it.
    await assertRejects(
      () => _recordOutboundRecipientMarkersForTest(mock, phone),
      Error,
      "RESOURCE_EXHAUSTED",
    );

    const day = easternDateString();
    const daily = await mock.get(metricsDailyDocPath(day));
    assert(daily, "the metrics/daily doc must exist with the failure flag");
    assertEquals(
      typeof daily.textsSentCounterFailedAt,
      "string",
      "a counter failure must stamp textsSentCounterFailedAt so the report can demote the day",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordOutboundRecipientMarkers: a clean write clears any stale textsSentCounterFailedAt", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const day = easternDateString();
    // A prior failed run left the flag set.
    await mock.set(metricsDailyDocPath(day), {
      textsSent: 5,
      textsSentCounterFailedAt: "2026-06-29T00:00:00.000Z",
    });

    const phone = "5551239101";
    await _recordOutboundRecipientMarkersForTest(mock, phone);

    const daily = await mock.get(metricsDailyDocPath(day));
    assert(daily, "daily doc exists");
    assertEquals(
      daily.textsSentCounterFailedAt,
      null,
      "a clean increment must clear the stale failure flag",
    );
    assertEquals(daily.textsSent, 6, "the counter still incremented");
    const lifetime = await mock.get(metricsLifetimeDocPath());
    assertEquals(lifetime?.textsSent, 1, "lifetime counter also incremented");
  } finally {
    setFirestoreClientForTests(null);
  }
});

const REPORT_DATE = "2026-06-15";
const YESTERDAY = "2026-06-14";

Deno.test("nightly report: a textsSentCounterFailedAt flag on yesterday forces ydSmsSentReliable=false", async () => {
  const db = nightlySetup();
  try {
    // Yesterday's daily doc has a textsSent value but a failure flag was
    // stamped — so the count is "possibly incomplete", not a measured number.
    db.docs.set(metricsDailyDocPath(YESTERDAY), {
      textsSent: 12,
      textsSentCounterFailedAt: "2026-06-29T03:00:00.000Z",
    });

    const result = await runNightlyReport(REPORT_DATE, { forceSend: true });
    assertEquals(
      result.counts.ydSmsSent,
      12,
      "the value still maps through (it's flagged, not dropped)",
    );
    assertEquals(
      result.counts.ydSmsSentReliable,
      false,
      "a textsSentCounterFailedAt flag must demote ydSmsSentReliable",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("nightly report: no textsSent failure flag → ydSmsSentReliable=true", async () => {
  const db = nightlySetup();
  try {
    db.docs.set(metricsDailyDocPath(YESTERDAY), { textsSent: 7 });
    const result = await runNightlyReport(REPORT_DATE, { forceSend: true });
    assertEquals(
      result.counts.ydSmsSentReliable,
      true,
      "absent the flag, ydSmsSent is trusted",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
