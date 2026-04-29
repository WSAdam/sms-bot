/**
 * Integration test: can ResID 1303013 be texted?
 *
 * Run:
 *   deno test --allow-env --allow-net --allow-read \
 *     --env-file=../../../../env/local \
 *     sms-flow/crm/dnc-check.test.ts
 */
import { assertEquals } from "jsr:@std/assert";
import { reservations } from "@core/magic-mirror";

const RES_ID = 1303013;

async function checkDnc(resid: number): Promise<{ found: boolean; dnc: boolean; guest: string }> {
  const query = reservations.query("ReservationId", "is", String(resid));
  const results = await query.run();
  const sorted: any = results.sortByDateModified("desc");
  const matched = sorted[0];

  if (!matched) {
    return { found: false, dnc: false, guest: "" };
  }

  const Dnc = matched.Dnc === true || matched.Dnc === "true" || matched.Dnc === 1;
  return { found: true, dnc: Dnc, guest: String(matched.GuestFullName ?? "") };
}

Deno.test(`ResID ${RES_ID} — DNC check`, async () => {
  const result = await checkDnc(RES_ID);

  console.log(`\n🔍 ResID: ${RES_ID}`);
  console.log(`👤 Guest: ${result.guest}`);
  console.log(`📋 Found: ${result.found}`);
  console.log(`🚫 DNC: ${result.dnc}`);
  console.log(result.dnc ? `\n🛑 BLOCKED — would NOT be texted` : `\n✅ CLEAR — would be texted`);

  assertEquals(result.found, true, `ResID ${RES_ID} not found in QB`);
  assertEquals(result.dnc, false, `ResID ${RES_ID} should NOT be DNC`);
});
