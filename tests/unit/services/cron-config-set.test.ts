// Guards the setCronConfig concurrent-write fix. The old setCronConfig read
// the config with getCronConfig(), merged the partial, then wrote with a plain
// set() — non-transactional. Two concurrent POST /api/config/cron requests
// editing DIFFERENT fields both read the same state and the later set()
// clobbered the earlier change. The fix does the read-merge-write inside one
// Firestore transaction (mirrors setGatesConfig).

import { assertEquals } from "@std/assert";
import {
  getCronConfig,
  setCronConfig,
} from "@core/business/cron-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("setCronConfig: concurrent edits to different fields don't clobber each other", async () => {
  const db = new FirestoreMock();
  // One request flips report.enabled, the other changes qbSaleMatch.reportId.
  // Pre-fix the second write would overwrite the first's report change.
  await Promise.all([
    setCronConfig({ report: { enabled: false } }, db),
    setCronConfig({ qbSaleMatch: { reportId: "999" } }, db),
  ]);

  const cfg = await getCronConfig(db);
  assertEquals(cfg.report.enabled, false);
  assertEquals(cfg.qbSaleMatch.reportId, "999");
});

Deno.test("setCronConfig: a single edit preserves all other fields", async () => {
  const db = new FirestoreMock();
  // Seed a full config first.
  await setCronConfig({
    report: { enabled: true, subjectPrefix: "[REPORT]" },
    qbSaleMatch: { reportId: "678", tableId: "bpb28qsnn" },
  }, db);
  // Now change ONLY report.enabled.
  const next = await setCronConfig({ report: { enabled: false } }, db);

  assertEquals(next.report.enabled, false);
  assertEquals(next.report.subjectPrefix, "[REPORT]");
  assertEquals(next.qbSaleMatch.reportId, "678");
  assertEquals(next.qbSaleMatch.tableId, "bpb28qsnn");
});
