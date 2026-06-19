// Coverage for the runtime guards in src/core/dto/readymode.ts. DialerDomain
// arrives as a bare string inside ReadyMode /trigger payloads, so these guards
// sit on the untrusted boundary — assert valid round-trip, junk rejection, and
// the deliberate case-sensitivity (RM subdomains are lowercase).
import { assertEquals, assertThrows } from "@std/assert";
import {
  DialerDomain,
  isDialerDomain,
  parseDialerDomain,
} from "@core/dto/readymode.ts";

Deno.test("isDialerDomain accepts known domain values, rejects junk/non-strings", () => {
  assertEquals(isDialerDomain("monsteract"), true);
  assertEquals(isDialerDomain(DialerDomain.ODR), true);
  assertEquals(isDialerDomain("nope"), false);
  assertEquals(isDialerDomain(""), false);
  assertEquals(isDialerDomain(null), false);
  assertEquals(isDialerDomain(123), false);
});

Deno.test("isDialerDomain is case-sensitive (RM sends lowercase subdomains)", () => {
  assertEquals(isDialerDomain("MonsterACT"), false);
  assertEquals(isDialerDomain("MONSTERODR"), false);
});

Deno.test("parseDialerDomain returns the enum for valid input, throws on invalid", () => {
  assertEquals(parseDialerDomain("monsterodr"), DialerDomain.ODR);
  assertEquals(parseDialerDomain("monsterrg"), DialerDomain.MONSTER);
  assertThrows(
    () => parseDialerDomain("garbage"),
    Error,
    "Invalid DialerDomain",
  );
  assertThrows(
    () => parseDialerDomain(undefined),
    Error,
    "Invalid DialerDomain",
  );
});
