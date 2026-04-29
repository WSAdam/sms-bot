import { assertEquals } from "@std/assert";
import {
  normalizePhone,
  normalizePhone11To10,
  toE164,
} from "@shared/util/phone.ts";

Deno.test("normalizePhone strips formatting from QB-style input", () => {
  assertEquals(normalizePhone("(936) 676-2277"), "9366762277");
});

Deno.test("normalizePhone strips leading 1 from E.164", () => {
  assertEquals(normalizePhone("+19366762277"), "9366762277");
  assertEquals(normalizePhone("19366762277"), "9366762277");
});

Deno.test("normalizePhone keeps already-10-digit input", () => {
  assertEquals(normalizePhone("9366762277"), "9366762277");
});

Deno.test("normalizePhone rejects bad input", () => {
  assertEquals(normalizePhone(null), null);
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone("123"), null);
  assertEquals(normalizePhone(123 as unknown as string), null);
});

Deno.test("toE164 round-trips a 10-digit phone", () => {
  assertEquals(toE164("9366762277"), "+19366762277");
  assertEquals(toE164("(936) 676-2277"), "+19366762277");
});

Deno.test("normalizePhone11To10 handles both 10- and 11-digit input", () => {
  assertEquals(normalizePhone11To10("19366762277"), {
    phone10: "9366762277",
    phone11: "19366762277",
  });
  assertEquals(normalizePhone11To10("9366762277"), {
    phone10: "9366762277",
    phone11: "19366762277",
  });
  assertEquals(normalizePhone11To10("12345"), null);
});
