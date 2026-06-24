// Guards the two fixes for the 2026-06-24 phantom-injection bug:
//   1. RM's lead-api returns HTTP 200 even when it REJECTS a lead (unrecognized
//      field → {"Accepted":false}). injectBodyExplicitlyRejected must catch that
//      so a 200 is never recorded as a created lead.
//   2. The normalized "notes" field must map to the domain's RM custom field
//      (Custom_52 on ODR/ACT) — sending raw "notes" is what got the whole lead
//      rejected.

import { assertEquals } from "@std/assert";
import {
  _buildLeadUrlForTest as buildLeadUrl,
  injectBodyExplicitlyRejected,
} from "@dialer/domain/business/lead-service/mod.ts";
import { leadFieldFor } from "@dialer/domain/business/mapping/mod.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

const BASE = "https://x.test/lead-api/abc";
const qp = (url: string) => new URL(url).searchParams;

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

Deno.test("buildLeadUrl: ODR translates notes → Custom_52 (raw 'notes' never sent)", () => {
  const p = qp(
    buildLeadUrl(BASE, { phone: "5551234567", notes: "hi" }, DialerDomain.ODR),
  );
  assertEquals(p.get("lead[0][Custom_52]"), "hi");
  assertEquals(p.get("lead[0][notes]"), null);
  assertEquals(p.get("lead[0][phone]"), "5551234567");
});

Deno.test("buildLeadUrl: ODR default note lands under Custom_52, never Custom_21", () => {
  const p = qp(buildLeadUrl(BASE, { phone: "5551234567" }, DialerDomain.ODR));
  const note = p.get("lead[0][Custom_52]") ?? "";
  assertEquals(note.includes("Scheduled Call Added at"), true);
  assertEquals(p.get("lead[0][Custom_21]"), null); // the known-bad field, never on ODR
});

Deno.test("buildLeadUrl: Monster maps notes → Custom_21", () => {
  const p = qp(
    buildLeadUrl(
      BASE,
      { phone: "5551234567", notes: "hi" },
      DialerDomain.MONSTER,
    ),
  );
  assertEquals(p.get("lead[0][Custom_21]"), "hi");
  assertEquals(p.get("lead[0][notes]"), null);
});

Deno.test("buildLeadUrl: explicit Custom_52 + raw notes does NOT double-emit (explicit wins)", () => {
  const p = qp(
    buildLeadUrl(
      BASE,
      { phone: "5551234567", notes: "a", Custom_52: "b" },
      DialerDomain.ODR,
    ),
  );
  assertEquals(p.getAll("lead[0][Custom_52]"), ["b"]); // single emission, explicit value
});

Deno.test("buildLeadUrl: unmapped domain drops the note instead of guessing a rejected field", () => {
  const p = qp(
    buildLeadUrl(BASE, { phone: "5551234567", notes: "x" }, DialerDomain.ODS),
  );
  assertEquals(p.get("lead[0][phone]"), "5551234567"); // lead still injects
  assertEquals(p.get("lead[0][notes]"), null);
  assertEquals(p.get("lead[0][Custom_21]"), null); // no guessed field
  assertEquals(p.get("lead[0][Custom_52]"), null);
});

Deno.test("leadFieldFor: notes maps to the domain's RM custom field (the inject fix)", () => {
  assertEquals(leadFieldFor(DialerDomain.ODR, "notes"), "Custom_52");
  assertEquals(leadFieldFor(DialerDomain.ACT, "notes"), "Custom_52");
  assertEquals(leadFieldFor(DialerDomain.MONSTER, "notes"), "Custom_21");
  // phone passes through unchanged.
  assertEquals(leadFieldFor(DialerDomain.ODR, "phone"), "phone");
});
