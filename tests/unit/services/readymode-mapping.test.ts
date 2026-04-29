import { assertEquals } from "@std/assert";
import {
  denormalize,
  normalize,
} from "@shared/services/readymode/mapping.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

Deno.test("normalize handles friendly URL params from ACT triggers", () => {
  const lead = normalize(DialerDomain.ACT, {
    primaryPhone: "(936) 676-2277",
    resID: "12345",
    desiredDestination1: "Vegas",
    leadDate: "2026-04-01",
  });
  assertEquals(lead.phone, "9366762277");
  assertEquals(lead.reservationId, "12345");
  assertEquals(lead.desiredDestination1, "Vegas");
  assertEquals(lead.leadDate, "2026-04-01");
});

Deno.test("normalize falls back to Custom_56 for reservationId", () => {
  const lead = normalize(DialerDomain.MONSTER, {
    phone: "5551234567",
    Custom_56: "98765",
  });
  assertEquals(lead.reservationId, "98765");
});

Deno.test("denormalize maps StandardLead → MONSTER Custom_XX fields", () => {
  const out = denormalize(DialerDomain.MONSTER, {
    phone: "5551234567",
    firstName: "Adam",
    reservationId: "111",
    destination: "Vegas",
    notes: "ABC",
  });
  assertEquals(out.phone, "5551234567");
  assertEquals(out.firstName, "Adam");
  assertEquals(out.Custom_1, "111"); // reservationId
  assertEquals(out.Custom_2, "Vegas"); // destination
  assertEquals(out.Custom_21, "ABC"); // notes
});

Deno.test("denormalize maps StandardLead → ODR Custom_XX fields", () => {
  const out = denormalize(DialerDomain.ODR, {
    phone: "5551234567",
    reservationId: "222",
    notes: "hot",
  });
  assertEquals(out.Custom_56, "222");
  assertEquals(out.Custom_52, "hot");
});

Deno.test("denormalize drops empty fields", () => {
  const out = denormalize(DialerDomain.MONSTER, {
    phone: "5551234567",
    firstName: "",
    notes: undefined,
  });
  assertEquals(out.firstName, undefined);
  assertEquals(out.Custom_21, undefined);
});
