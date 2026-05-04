// import-call-dispositions.ts
//
// One-shot historical import: reads a ReadyMode call-log CSV (the format
// Adam exported on 2026-05-04, "call_log_report_*.csv") and marks any phone
// that received a non-no-answer disposition as "answered" in our system —
// same write that POST /api/guests/answered does, just bulk and from the
// CSV's Log Time as the answeredAt timestamp.
//
// Treats anything other than "No Answer" or "TEST" as an answered call:
// Sale (NO MCC), Sale (MCC), Not interested, Do Not Call, Wrong Number,
// Transfer, Cancelled Package, Not Qualified, etc. all count.
//
// Multiple calls for the same phone collapse to the LATEST non-no-answer
// log time so re-runs are deterministic. Excluded test phones (Adam's
// 8432222986) are skipped.
//
// Run:
//   deno task import-call-dispositions -- <path-to-csv> [--dry-run]

import { parse } from "@std/csv";
import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const args = Deno.args.filter((a) => !a.startsWith("--"));
const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const csvPath = args[0];
const DRY_RUN = flags.has("--dry-run");

if (!csvPath) {
  console.error("Usage: deno task import-call-dispositions -- <path-to-csv> [--dry-run]");
  Deno.exit(1);
}

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

const EXCLUDED_PHONES = new Set<string>(["8432222986"]); // Adam's test phone
const SKIP_LOG_TYPES = new Set<string>([
  "No Answer",
  "TEST",
]);
const BATCH_SIZE = 400;

function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

function parseUSDate(s: string): string | null {
  // "02/11/2026 3:38:49 PM" → ISO. Date constructor handles this format
  // natively in Deno/V8.
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

async function main() {
  console.log(`🚀 Importing call dispositions from ${csvPath}`);
  console.log(`   FIREBASE_PROJECT_ID = ${FIREBASE_PROJECT_ID}`);
  console.log(`   DRY_RUN             = ${DRY_RUN}`);
  console.log("");

  const text = await Deno.readTextFile(csvPath);
  const rows = parse(text, { skipFirstRow: true }) as Record<string, string>[];
  console.log(`📄 Parsed ${rows.length} rows`);

  let scanned = 0;
  let skippedTest = 0;
  let skippedNoAnswer = 0;
  let skippedExcluded = 0;
  let skippedBadPhone = 0;
  let skippedBadDate = 0;

  // phone10 → latest answeredAt ISO string
  const latestByPhone = new Map<string, string>();

  for (const row of rows) {
    scanned++;
    const logType = (row["Log Type"] ?? "").trim();
    if (SKIP_LOG_TYPES.has(logType)) {
      if (logType === "No Answer") skippedNoAnswer++;
      else skippedTest++;
      continue;
    }
    const phone10 = normalizePhone(row["Phone"]);
    if (!phone10) {
      skippedBadPhone++;
      continue;
    }
    if (EXCLUDED_PHONES.has(phone10)) {
      skippedExcluded++;
      continue;
    }
    const answeredAt = parseUSDate(row["Log Time"]);
    if (!answeredAt) {
      skippedBadDate++;
      continue;
    }
    const existing = latestByPhone.get(phone10);
    if (!existing || answeredAt > existing) {
      latestByPhone.set(phone10, answeredAt);
    }
  }

  console.log("");
  console.log(`📊 Plan:`);
  console.log(`   scanned             ${scanned}`);
  console.log(`   skipped TEST        ${skippedTest}`);
  console.log(`   skipped No Answer   ${skippedNoAnswer}`);
  console.log(`   skipped excluded    ${skippedExcluded}`);
  console.log(`   skipped bad phone   ${skippedBadPhone}`);
  console.log(`   skipped bad date    ${skippedBadDate}`);
  console.log(`   unique phones to write  ${latestByPhone.size}`);
  console.log("");

  if (DRY_RUN) {
    const sample = Array.from(latestByPhone.entries()).slice(0, 5);
    console.log("🧪 DRY RUN — sample writes that would happen:");
    for (const [p, t] of sample) console.log(`   ${p} → answeredAt=${t}`);
    Deno.exit(0);
  }

  if (latestByPhone.size === 0) {
    console.log("✨ Nothing to write");
    Deno.exit(0);
  }

  const entries = Array.from(latestByPhone.entries());
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const [phone10, answeredAt] of chunk) {
      batch.set(db.doc(`sms-bot/guestanswered/byPhone/${phone10}`), {
        phone10,
        answered: true,
        answeredAt,
      });
    }
    await batch.commit();
    const n = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `✅ Batch ${n}: wrote ${chunk.length} (total ${i + chunk.length}/${entries.length})`,
    );
  }
  console.log("");
  console.log(`🎉 Done — wrote ${entries.length} guestanswered docs`);
  Deno.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  Deno.exit(1);
});
