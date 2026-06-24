// Guards the two fixes for the 2026-06-24 phantom-injection bug:
//   1. RM's lead-api returns HTTP 200 even when it REJECTS a lead (unrecognized
//      field → {"Accepted":false}). injectBodyExplicitlyRejected must catch that
//      so a 200 is never recorded as a created lead.
//   2. The normalized "notes" field must map to the domain's RM custom field
//      (Custom_52 on ODR/ACT) — sending raw "notes" is what got the whole lead
//      rejected.

import { assertEquals } from "@std/assert";
import { injectBodyExplicitlyRejected } from "@dialer/domain/business/lead-service/mod.ts";
import { leadFieldFor } from "@dialer/domain/business/mapping/mod.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

Deno.test("injectBodyExplicitlyRejected: the exact RM rejection (Accepted:false) is a failure", () => {
  const text =
    '{ "0": { "Success": false, "Error": "Field not recognized", "Field": "notes", "Accepted": false } }';
  assertEquals(injectBodyExplicitlyRejected(text, JSON.parse(text)), true);
});

Deno.test("injectBodyExplicitlyRejected: Success:false alone is a failure", () => {
  const text = '{"0":{"Success":false}}';
  assertEquals(injectBodyExplicitlyRejected(text, JSON.parse(text)), true);
});

Deno.test("injectBodyExplicitlyRejected: a genuine success is NOT a rejection", () => {
  const text = '{"0":{"Success":true,"Accepted":true,"xencall_leadId":123}}';
  assertEquals(injectBodyExplicitlyRejected(text, JSON.parse(text)), false);
});

Deno.test("injectBodyExplicitlyRejected: ambiguous/empty body is NOT a hard rejection (HTTP status decides upstream)", () => {
  assertEquals(injectBodyExplicitlyRejected("OK", null), false);
  assertEquals(injectBodyExplicitlyRejected("", null), false);
});

Deno.test("injectBodyExplicitlyRejected: text fallback catches Accepted:false even when JSON shape differs", () => {
  assertEquals(
    injectBodyExplicitlyRejected('x "Accepted": false x', null),
    true,
  );
  assertEquals(
    injectBodyExplicitlyRejected('x "Accepted":false x', null),
    true,
  );
});

Deno.test("leadFieldFor: notes maps to the domain's RM custom field (the inject fix)", () => {
  assertEquals(leadFieldFor(DialerDomain.ODR, "notes"), "Custom_52");
  assertEquals(leadFieldFor(DialerDomain.ACT, "notes"), "Custom_52");
  assertEquals(leadFieldFor(DialerDomain.MONSTER, "notes"), "Custom_21");
  // phone passes through unchanged.
  assertEquals(leadFieldFor(DialerDomain.ODR, "phone"), "phone");
});
