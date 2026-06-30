// Regression guard for the missing-index incident (2026-06-24..30).
//
// The dedup guard in src/sms-flow/domain/business/delayed-injection/mod.ts runs
// `list(injectionhistory) where(phone ==) orderBy(firedAt desc)`. That query
// shape REQUIRES a (phone asc, firedAt desc) composite index on the `byPhone`
// collection group. The index was dropped in d38c1d8 (2026-05-22) as "unused",
// then c86b93a (2026-06-24) added the orderBy without restoring it — every cron
// injection then threw "The query requires an index" and was silently consumed.
//
// This test fails CI if that index ever disappears from firestore.indexes.json
// again. The dedup guard now also fails OPEN, but the index must still exist for
// the guard to actually dedup — DO NOT delete it to make this test pass.

import { assert } from "@std/assert";

interface IndexField {
  fieldPath: string;
  order?: string;
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope?: string;
  fields: IndexField[];
}

Deno.test("firestore.indexes.json defines the (phone, firedAt) byPhone composite index", async () => {
  const url = new URL("../../../firestore.indexes.json", import.meta.url);
  const json = JSON.parse(await Deno.readTextFile(url)) as {
    indexes: CompositeIndex[];
  };

  const found = json.indexes.some((idx) =>
    idx.collectionGroup === "byPhone" &&
    idx.fields.length === 2 &&
    idx.fields[0].fieldPath === "phone" &&
    idx.fields[0].order === "ASCENDING" &&
    idx.fields[1].fieldPath === "firedAt" &&
    idx.fields[1].order === "DESCENDING"
  );

  assert(
    found,
    "MISSING the (phone ASC, firedAt DESC) byPhone composite index required by " +
      "the injection dedup guard. Without it every cron injection throws " +
      "'The query requires an index' and is silently consumed. Re-add it to " +
      "firestore.indexes.json and `firebase deploy --only firestore:indexes`.",
  );
});
