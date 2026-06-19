import { assertEquals } from "#assert";
import { formatPhoneForQb } from "./mod.ts";
Deno.test("qb-reservations: formats a phone for QB EX queries", () => {
  assertEquals(formatPhoneForQb("8432222986"), "(843) 222-2986");
});
