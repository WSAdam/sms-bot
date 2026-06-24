// Guards the nightly-report TOCTOU fix. The old cron read lastSentEtDate,
// checked it, sent the email, THEN wrote the marker — two concurrent fires
// (Deno Deploy retry / clock skew) both saw the stale value and both sent.
// claimReportDay atomically sets lastSentEtDate ONLY if it isn't already today,
// returning whether THIS caller won — so the email goes out exactly once.

import { assertEquals } from "@std/assert";
import {
  claimReportDay,
  getCronConfig,
} from "@core/business/cron-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("claimReportDay: first call wins, second call for the same day loses", async () => {
  const db = new FirestoreMock();
  assertEquals(await claimReportDay("2026-06-24", db), true);
  assertEquals(await claimReportDay("2026-06-24", db), false);
});

Deno.test("claimReportDay: concurrent fires — exactly ONE wins the day", async () => {
  const db = new FirestoreMock();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => claimReportDay("2026-06-25", db)),
  );
  assertEquals(results.filter((r) => r === true).length, 1);
});

Deno.test("claimReportDay: a new day is claimable again", async () => {
  const db = new FirestoreMock();
  assertEquals(await claimReportDay("2026-06-26", db), true);
  assertEquals(await claimReportDay("2026-06-27", db), true);
});

Deno.test("claimReportDay: persists lastSentEtDate so getCronConfig reflects the claim", async () => {
  const db = new FirestoreMock();
  await claimReportDay("2026-06-28", db);
  const cfg = await getCronConfig(db);
  assertEquals(cfg.report.lastSentEtDate, "2026-06-28");
});
