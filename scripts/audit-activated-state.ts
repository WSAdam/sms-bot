// Snapshot every collection touched by the sale-match flow so we can
// reconstruct what state each known-activated phone is in. Read-only.

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
const serviceAccount = inlineJson
  ? JSON.parse(inlineJson)
  : JSON.parse(await Deno.readTextFile(credPath!));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ preferRest: true });

async function loadIds(
  path: string,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

const [activated, within, outside, history] = await Promise.all([
  loadIds("sms-bot/guestactivated/byPhone"),
  loadIds("sms-bot/saleswithin7d/byPhone"),
  loadIds("sms-bot/salesoutsidewindow/byPhone"),
  loadIds("sms-bot/injectionhistory/byPhone"),
]);

const phonesWithHistory = new Set<string>();
for (const h of history) {
  const sep = h.id.indexOf("__");
  const phone = sep >= 0 ? h.id.slice(0, sep) : h.id;
  phonesWithHistory.add(phone);
}

console.log("=== Counts ===");
console.log(`guestactivated:     ${activated.length}`);
console.log(`saleswithin7d:      ${within.length}`);
console.log(`salesoutsidewindow: ${outside.length}`);
console.log(
  `injectionhistory:   ${history.length} docs / ${phonesWithHistory.size} unique phones`,
);
console.log("");

console.log("=== Activated guests (sorted by activatedAt) ===");
const sorted = activated.slice().sort((a, b) => {
  const at = String((a.data as Record<string, unknown>).activatedAt ?? "");
  const bt = String((b.data as Record<string, unknown>).activatedAt ?? "");
  return at.localeCompare(bt);
});
for (const a of sorted) {
  const d = a.data as Record<string, unknown>;
  console.log(
    `${a.id}  activatedAt=${d.activatedAt ?? "?"}  matchReason=${
      d.matchReason ?? "?"
    }  office="${d.office ?? ""}"  activator="${d.activator ?? ""}"`,
  );
}
console.log("");

console.log("=== Outside Window (could be claimed back) ===");
for (const o of outside) {
  const d = o.data as Record<string, unknown>;
  console.log(
    `${o.id}  activatedAt=${d.activatedAt ?? "?"}  daysOff=${
      d.closestDaysDiff ?? "?"
    }  office="${d.office ?? ""}"  activator="${d.activator ?? ""}"`,
  );
}
console.log("");

const activatedSet = new Set(activated.map((a) => a.id));
const withinSet = new Set(within.map((w) => w.id));
const outsideSet = new Set(outside.map((o) => o.id));

const onlyWithin = within.filter((w) => !activatedSet.has(w.id));
const onlyActivated = activated.filter((a) => !withinSet.has(a.id));
console.log(`=== Asymmetries ===`);
console.log(`In within7d but NOT in activated: ${onlyWithin.length}`);
onlyWithin.forEach((w) => console.log(`  - ${w.id}`));
console.log(`In activated but NOT in within7d: ${onlyActivated.length}`);
onlyActivated.forEach((a) => console.log(`  - ${a.id}`));

console.log("");
console.log(`=== Phones in outside-window AND have injection history ===`);
for (const o of outside) {
  if (phonesWithHistory.has(o.id)) {
    console.log(
      `  - ${o.id} (has injection history → real lead, candidate to claim)`,
    );
  }
}

Deno.exit(0);
