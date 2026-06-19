import { assertEquals } from "#assert";
import { withTiming } from "./mod.ts";

Deno.test("withTiming returns the wrapped value", async () => {
  const r = await withTiming("t", () => Promise.resolve(42));
  assertEquals(r, 42);
});

Deno.test("withTiming rethrows on failure", async () => {
  let threw = false;
  try {
    await withTiming("t", () => Promise.reject(new Error("boom")));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
