// Audit save/check semantics (claim race + override + dual-write).

import { assertEquals } from "@std/assert";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  checkAuditMarker,
  saveAuditMarker,
} from "@shared/services/audit/service.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function setup() {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  return db;
}

Deno.test("default save mirrors legacy + landing", async () => {
  const db = setup();
  await saveAuditMarker({ recordId: "rec1" });
  // Legacy global key + landing-stage mirror
  assertEquals((await db.get("sms-bot/audit/byRecordId/rec1"))?.stage, null);
  assertEquals(
    (await db.get("sms-bot/auditstage/landing/rec1"))?.stage,
    "landing",
  );
});

Deno.test("claim mode: first call wins, second sees existing", async () => {
  setup();
  const first = await saveAuditMarker({ recordId: "rec2", claim: true });
  assertEquals(first.created, true);
  assertEquals(first.existed, false);

  const second = await saveAuditMarker({ recordId: "rec2", claim: true });
  assertEquals(second.created, false);
  assertEquals(second.existed, true);
  assertEquals(second.timestamp, first.timestamp);
});

Deno.test("override always writes regardless of existing", async () => {
  const db = setup();
  await saveAuditMarker({ recordId: "rec3", source: "first" });
  await saveAuditMarker({
    recordId: "rec3",
    source: "second",
    override: true,
  });
  const v = await db.get("sms-bot/audit/byRecordId/rec3");
  assertEquals(v?.source, "second");
});

Deno.test("explicit landing stage also writes legacy key", async () => {
  const db = setup();
  await saveAuditMarker({ recordId: "rec4", stage: "landing" });
  assertEquals(
    (await db.get("sms-bot/audit/byRecordId/rec4"))?.stage,
    "landing",
  );
});

Deno.test("checkAuditMarker reflects stage + legacy state", async () => {
  setup();
  await saveAuditMarker({ recordId: "rec5", stage: "live" });

  const live = await checkAuditMarker({ recordId: "rec5", stage: "live" });
  assertEquals(live.exists, true);

  const landing = await checkAuditMarker({ recordId: "rec5", stage: "landing" });
  assertEquals(landing.exists, false);
});
