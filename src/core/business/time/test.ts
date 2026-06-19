import { assertEquals } from "#assert";
import { easternDateString } from "./mod.ts";
Deno.test("time: exposes helpers", () => {
  assertEquals(typeof easternDateString, "function");
});
