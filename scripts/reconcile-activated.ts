// reconcile-activated.ts
//
// Find phones that are in saleswithin7d but MISSING from guestactivated, then
// reconstruct the guestactivated doc from the within7d marker so the lifetime
// Activated count returns to its true value.
//
// Background: every saleswithin7d marker is supposed to be written alongside
// a matching guestactivated doc (same phone10 doc-id) by the cron and the
// claim endpoint. The Toggle button on /search and the raw /api/kv/delete
// endpoint can silently delete a guestactivated doc without touching the
// within7d marker, leaving an asymmetry. This script finds and fixes it.
//
// Run:
//   deno task reconcile-activated [--dry-run]
//
// Re-runnable: a phone that already has both docs is left alone.

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

const SALESWITHIN7D = "sms-bot/saleswithin7d/byPhone";
const GUESTACTIVATED = "sms-bot/guestactivated/byPhone";
const BATCH_SIZE = 400;

interface MarkerDoc {
  phone10?: string;
  appointmentAt?: string | null;
  saleAt?: string;
  matchReason?: string;
  activator?: string | null;
  office?: string | null;
}

async function main() {
  console.log(`🚀 reconcile-activated`);
  console.log(`   FIREBASE_PROJECT_ID = ${FIREBASE_PROJECT_ID}`);
  console.log(`   DRY_RUN             = ${DRY_RUN}`);
  console.log("");

  console.log(`🔍 Loading ${SALESWITHIN7D}...`);
  const within = await db.collection(SALESWITHIN7D).get();
  console.log(`   ${within.size} marker docs`);

  console.log(`🔍 Loading ${GUESTACTIVATED}...`);
  const activated = await db.collection(GUESTACTIVATED).get();
  console.log(`   ${activated.size} activated docs`);

  const activatedSet = new Set<string>(activated.docs.map((d) => d.id));

  // Find within7d phones missing from guestactivated.
  const missing: Array<{ phone10: string; data: MarkerDoc }> = [];
  for (const d of within.docs) {
    const phone10 = d.id;
    if (activatedSet.has(phone10)) continue;
    missing.push({ phone10, data: d.data() as MarkerDoc });
  }

  console.log("");
  console.log(`🩹 Missing guestactivated docs: ${missing.length}`);
  for (const m of missing) {
    console.log(
      `   - ${m.phone10}  saleAt=${m.data.saleAt ?? "?"}  reason=${
        m.data.matchReason ?? "?"
      }  office="${m.data.office ?? ""}"  activator="${
        m.data.activator ?? ""
      }"`,
    );
  }

  if (missing.length === 0) {
    console.log("");
    console.log(
      "✅ Nothing to do — every within7d marker has a matching activated doc.",
    );
    Deno.exit(0);
  }

  if (DRY_RUN) {
    console.log("");
    console.log(
      `🧪 DRY RUN — would write ${missing.length} guestactivated docs`,
    );
    Deno.exit(0);
  }

  // Reconstruct each guestactivated doc from its within7d marker. Same shape
  // the cron writes; preserves the original saleAt as activatedAt so the
  // dashboard column shows the real activation date, not "now".
  const recordedAt = new Date().toISOString();
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { phone10, data } of chunk) {
      const ref = db.doc(`${GUESTACTIVATED}/${phone10}`);
      batch.set(ref, {
        phone10,
        Activated: true,
        activatedAt: data.saleAt ?? recordedAt,
        eventTime: data.appointmentAt ?? null,
        matchReason: data.matchReason ?? "manual_override",
        recordedAt,
        reconciledAt: recordedAt,
        ...(data.activator ? { activator: data.activator } : {}),
        ...(data.office ? { office: data.office } : {}),
      });
    }
    await batch.commit();
    console.log(`   ✍️  restored ${i + chunk.length}/${missing.length}`);
  }

  console.log("");
  console.log(`🎉 Done — restored ${missing.length} guestactivated docs.`);
  Deno.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  Deno.exit(1);
});
