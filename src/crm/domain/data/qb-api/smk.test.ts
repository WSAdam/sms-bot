import { assertEquals } from "#assert";
import { queryRecords, upsertRecords } from "./mod.ts";
Deno.test("qb-api: exports the query/upsert adapters", () => {
  assertEquals(typeof queryRecords, "function");
  assertEquals(typeof upsertRecords, "function");
});
