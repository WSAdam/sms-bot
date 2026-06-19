import { assertEquals } from "#assert";
import { verifyCanaryBearer } from "./mod.ts";
Deno.test("bearer: exposes api", () => {
  assertEquals(typeof verifyCanaryBearer, "function");
});
