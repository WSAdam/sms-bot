// Phase 1 RED — these tests are written BEFORE the validator exists.
// The module import below resolves to a not-yet-created file so the suite
// fails at compile time. That failure IS the red signal.
//
// Once `shared/services/readymode/validate-trigger.ts` exports
// parseTriggerPayload, every case below must pass.

import { assertEquals } from "@std/assert";
import { parseTriggerPayload } from "@shared/services/readymode/validate-trigger.ts";

// Verbatim production-failure payload that motivated this whole change.
const PRODUCTION_BAD_PAYLOAD = {
  phone: "primaryPhone=(203) 360-9279",
  dialer: "ReadyMode",
  dialerDomain: "monsteract",
  resID: "384901",
  LeadDate: "",
  urlLinkToRecord:
    "https://monsterrg.quickbase.com/db/bmhvhc72c?a=dr&rid=384901",
  office: "BookVIP",
  totalPrice: "115",
  destination: "MST - Travel America Promotion",
  campaign: "Act NE 3",
  attempts: "(times_called)",
  address: "Connecticut 28205",
  firstName: "Tiesha",
  lastName: "Mack",
};

const HAPPY_PAYLOAD = {
  phone: "(203) 360-9279",
  dialerDomain: "monsteract",
  resID: "384901",
  attempts: "47",
  office: "BookVIP",
  destination: "MST - Travel America Promotion",
  campaign: "Act NE 3",
  firstName: "Tiesha",
  lastName: "Mack",
};

Deno.test("rejects the verbatim production-failure payload (phone contamination)", () => {
  // The real payload had a contaminated phone — that alone is sufficient
  // to reject, and phone is validated before attempts. Even though the
  // (times_called) attempts placeholder is now whitelisted, the phone
  // contamination check still fires first.
  const r = parseTriggerPayload(PRODUCTION_BAD_PAYLOAD);
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals(r.error.field, "phone");
});

Deno.test("(times_called) attempts is whitelisted → dto.attempts === undefined", () => {
  // Upstream RM template is broken and ships the literal placeholder.
  // We don't reject anymore; the service is expected to look the real
  // value up via the TPI client before the attempts gate.
  const r = parseTriggerPayload({
    ...HAPPY_PAYLOAD,
    attempts: "(times_called)",
  });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.dto.attempts, undefined);
});

Deno.test("rejects attempts placeholder variants OTHER than (times_called)", () => {
  // Only the one specific known-broken token is whitelisted. Any other
  // placeholder in this field is a different bug and still rejects.
  for (const bad of ["(attempts)", "(first_name)", "(times)", "abc", ""]) {
    const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, attempts: bad });
    assertEquals(r.ok, false, `expected rejection for attempts=${bad}`);
    if (!r.ok) assertEquals(r.error.field, "attempts");
  }
});

Deno.test("rejects attempts negative", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, attempts: -1 });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "attempts");
});

Deno.test("rejects attempts non-integer", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, attempts: 1.5 });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "attempts");
});

Deno.test("rejects when attempts is missing entirely and no override", () => {
  const { attempts: _drop, ...rest } = HAPPY_PAYLOAD;
  const r = parseTriggerPayload(rest);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "attempts");
});

Deno.test("rejects contaminated phone with embedded key=value", () => {
  const r = parseTriggerPayload({
    ...HAPPY_PAYLOAD,
    phone: "primaryPhone=(203) 360-9279",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "phone");
});

Deno.test("rejects phone that is a placeholder", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, phone: "(name)" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "phone");
});

Deno.test("rejects empty phone", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, phone: "" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "phone");
});

Deno.test("rejects phone with too few digits", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, phone: "12345" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "phone");
});

Deno.test("rejects placeholder on any string field (firstName)", () => {
  const r = parseTriggerPayload({
    ...HAPPY_PAYLOAD,
    firstName: "(first_name)",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "firstName");
});

Deno.test("rejects placeholder on any string field (campaign)", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, campaign: "(campaign)" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "campaign");
});

Deno.test("rejects placeholder on any string field (destination)", () => {
  const r = parseTriggerPayload({
    ...HAPPY_PAYLOAD,
    destination: "(destination)",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "destination");
});

Deno.test("rejects unknown/unresolvable dialerDomain", () => {
  const r = parseTriggerPayload({ ...HAPPY_PAYLOAD, dialerDomain: "nope" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "dialerDomain");
});

Deno.test("rejects missing resID", () => {
  const { resID: _drop, ...rest } = HAPPY_PAYLOAD;
  const r = parseTriggerPayload(rest);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "resID");
});

Deno.test("happy path: normalizes phone to 10 digits and parses attempts as number", () => {
  const r = parseTriggerPayload(HAPPY_PAYLOAD);
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.dto.phone, "2033609279");
  assertEquals(r.dto.attempts, 47);
  assertEquals(r.dto.resID, "384901");
  assertEquals(r.dto.dialerDomain, "monsteract");
  assertEquals(r.dto.firstName, "Tiesha");
});

Deno.test("override=true bypasses attempts requirement", () => {
  const { attempts: _drop, ...rest } = HAPPY_PAYLOAD;
  const r = parseTriggerPayload({ ...rest, override: true });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.dto.override, true);
  assertEquals(r.dto.attempts, 0);
});

Deno.test("override='true' string also bypasses attempts", () => {
  const { attempts: _drop, ...rest } = HAPPY_PAYLOAD;
  const r = parseTriggerPayload({ ...rest, override: "true" });
  assertEquals(r.ok, true);
});

Deno.test("override does NOT bypass placeholder check on other fields", () => {
  const r = parseTriggerPayload({
    ...HAPPY_PAYLOAD,
    override: true,
    firstName: "(first_name)",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error.field, "firstName");
});

Deno.test("accepts primaryPhone fallback when phone is absent", () => {
  const { phone: _drop, ...rest } = HAPPY_PAYLOAD;
  const r = parseTriggerPayload({ ...rest, primaryPhone: "(203) 360-9279" });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.dto.phone, "2033609279");
});
