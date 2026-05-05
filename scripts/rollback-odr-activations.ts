// rollback-odr-activations.ts
//
// One-shot cleanup for the over-broad ODR-activator match that ran on
// 2026-05-05. The cron counted EVERY ODR activation in QB report 678
// (~2,008 phones) regardless of whether we'd ever touched them via SMS.
// This script deletes every saleswithin7d and guestactivated doc where
// matchReason === "odr_activator", restoring the within-window matches.
//
// Run:
//   deno task rollback-odr-activations [--dry-run]
//
// Re-runnable: deletes only matchReason="odr_activator", preserves
// matchReason="within_window" and any docs without matchReason.

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const DRY_RUN = flags.has("--dry-run");

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID");
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");

if (!FIREBASE_PROJECT_ID) {
  console.error("❌ Missing FIREBASE_PROJECT_ID");
  Deno.exit(1);
}
if (!inlineJson && !credPath) {
  console.error(
    "❌ Need FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS",
  );
  Deno.exit(1);
}

const serviceAccount = inlineJson
  ? JSON.parse(inlineJson)
  : JSON.parse(await Deno.readTextFile(credPath!));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ preferRest: true });

const COLLECTIONS = [
  "sms-bot/saleswithin7d/byPhone",
  "sms-bot/guestactivated/byPhone",
];
const BATCH_SIZE = 400;

async function rollback(collectionPath: string): Promise<number> {
  console.log(`🔍 Scanning ${collectionPath}...`);
  const snap = await db.collection(collectionPath).get();
  const toDelete: string[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.matchReason === "odr_activator") {
      toDelete.push(d.id);
    }
  }
  console.log(
    `   ${snap.size} total docs, ${toDelete.length} match matchReason="odr_activator"`,
  );

  if (DRY_RUN || toDelete.length === 0) return toDelete.length;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.delete(db.doc(`${collectionPath}/${id}`));
    }
    await batch.commit();
    console.log(
      `   🗑️  deleted ${i + chunk.length}/${toDelete.length}`,
    );
  }
  return toDelete.length;
}

async function main() {
  console.log(`🚀 ODR-activator rollback`);
  console.log(`   FIREBASE_PROJECT_ID = ${FIREBASE_PROJECT_ID}`);
  console.log(`   DRY_RUN             = ${DRY_RUN}`);
  console.log("");

  let total = 0;
  for (const path of COLLECTIONS) {
    total += await rollback(path);
  }

  console.log("");
  if (DRY_RUN) {
    console.log(`🧪 DRY RUN — would delete ${total} docs total`);
  } else {
    console.log(`🎉 Done — deleted ${total} docs total`);
  }
  Deno.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  Deno.exit(1);
});
