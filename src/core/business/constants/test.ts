import { assertEquals } from "#assert";
import { ROOT_COLLECTION } from "./mod.ts";
Deno.test("constants: exposes values", () => {
  assertEquals(typeof ROOT_COLLECTION, "string");
});
