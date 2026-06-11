// restore-sale.ts
//
// Manually write a saleswithin7d + guestactivated pair for a single phone.
// Used ONLY for sales that QB cannot see (e.g. Bland-channel / off-system
// activations). For anything in QB report 678, run the activate-from-report
// endpoint instead — it pulls the correct date + activator straight from QB.
//
// SALE_AT must be the real QB "Date Activated" value (when the date leg
// was created in QB), NOT the moment you run this script. There is no
// default — passing the wrong date corrupts the dashboard's day-window math.
//
// Usage:
//   PHONE=2695982195 ACTIVATOR="ODR - X" SALE_AT=2026-05-06T12:00:00Z \
//     deno run -A --env-file=env/local scripts/restore-sale.ts

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
const serviceAccount = inlineJson
  ? JSON.parse(inlineJson)
  : JSON.parse(await Deno.readTextFile(credPath!));

const PHONE = Deno.env.get("PHONE");
const SALE_AT = Deno.env.get("SALE_AT");
const ACTIVATOR = Deno.env.get("ACTIVATOR") ?? null;
const OFFICE = Deno.env.get("OFFICE") ?? null;
const NOTE = Deno.env.get("NOTE") ?? "manual restore via script";

if (!PHONE || PHONE.length !== 10) {
  console.error("❌ Set PHONE=<10-digit phone>");
  Deno.exit(1);
}
if (!SALE_AT) {
  console.error(
    '❌ SALE_AT is required. Pass the QB "Date Activated" value, e.g. ' +
      "SALE_AT=2026-05-06T12:00:00Z (noon UTC matches QB's convention).",
  );
  Deno.exit(1);
}
const saleAtMs = new Date(SALE_AT).getTime();
if (!Number.isFinite(saleAtMs)) {
  console.error(`❌ SALE_AT="${SALE_AT}" is not a valid ISO timestamp`);
  Deno.exit(1);
}
if (saleAtMs > Date.now()) {
  console.error(
    `❌ SALE_AT="${SALE_AT}" is in the future. SALE_AT must be the real QB ` +
      `"Date Activated" value — never the appointment time, never a future date.`,
  );
  Deno.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ preferRest: true });

const updatedAt = new Date().toISOString();
const marker = {
  phone10: PHONE,
  phone11: `1${PHONE}`,
  appointmentAt: null,
  saleAt: SALE_AT,
  windowDays: 8,
  withinDays: null,
  matchReason: "manual_override",
  ...(ACTIVATOR ? { activator: ACTIVATOR } : {}),
  ...(OFFICE ? { office: OFFICE } : {}),
  updatedAt,
  meta: { restoredAt: updatedAt, note: NOTE },
};

const activated = {
  phone10: PHONE,
  Activated: true,
  activatedAt: SALE_AT,
  eventTime: null,
  // No appointment to compare against, so withinDays is unknowable. The
  // dashboard's qualifying filter requires a number, so this row will be
  // excluded from Qualifying and only show in Lifetime.
  withinDays: null,
  matchReason: "manual_override",
  recordedAt: updatedAt,
  ...(ACTIVATOR ? { activator: ACTIVATOR } : {}),
  ...(OFFICE ? { office: OFFICE } : {}),
};

console.log(`🩹 Restoring sale for ${PHONE}`);
console.log(
  `   saleAt=${SALE_AT} activator="${ACTIVATOR ?? ""}" office="${
    OFFICE ?? ""
  }"`,
);

const batch = db.batch();
batch.set(db.doc(`sms-bot/saleswithin7d/byPhone/${PHONE}`), marker);
batch.set(db.doc(`sms-bot/guestactivated/byPhone/${PHONE}`), activated);
await batch.commit();

console.log(`✅ Wrote saleswithin7d + guestactivated for ${PHONE}`);
Deno.exit(0);
