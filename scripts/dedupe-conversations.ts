// dedupe-conversations.ts
//
// One-shot historical cleanup. Walks sms-bot/conversations/messages, groups by
// (callId, sender, message), keeps the earliest-timestamp doc per group, and
// deletes the rest.
//
// Pre-dedupe (storeMessage's 5-min window shipped Apr 30 2026), Bland's
// pathway fired the conversation webhook twice per round — same content, two
// docs. The dashboard already in-memory dedupes for display; this script
// physically removes the dupes so search, audit, and any future query that
// doesn't dedupe also see clean data.
//
// Run:
//   deno run -A --env-file=env/local scripts/dedupe-conversations.ts [--dry-run] [--page-size=N]
//
// Re-runs are safe (a deduped collection has nothing to dedupe).

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

interface Args {
  dryRun: boolean;
  pageSize: number;
}

function parseArgs(rawArgs: string[]): Args {
  const out: Args = { dryRun: false, pageSize: 1000 };
  for (const a of rawArgs) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--page-size=")) {
      out.pageSize = parseInt(a.slice("--page-size=".length), 10);
    }
  }
  return out;
}

const args = parseArgs(Deno.args);

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID");
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");

if (!FIREBASE_PROJECT_ID) {
  console.error("❌ Missing FIREBASE_PROJECT_ID");
  Deno.exit(1);
}
if (!inlineJson && !credPath) {
  console.error(
    "❌ Need either FIREBASE_SERVICE_ACCOUNT_JSON (inline) or GOOGLE_APPLICATION_CREDENTIALS (path)",
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

const COLLECTION = "sms-bot/conversations/messages";
const BATCH_SIZE = 400;

interface MsgDoc {
  id: string;
  callId?: string;
  sender?: string;
  message?: string;
  timestamp?: string;
}

async function fetchAll(pageSize: number): Promise<MsgDoc[]> {
  console.log(`🔍 Walking ${COLLECTION} (pageSize=${pageSize})...`);
  const out: MsgDoc[] = [];
  // deno-lint-ignore no-explicit-any
  let lastDoc: any = null;
  while (true) {
    // deno-lint-ignore no-explicit-any
    let q: any = db.collection(COLLECTION).orderBy("__name__").limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    // deno-lint-ignore no-explicit-any
    snap.docs.forEach((d: any) => {
      const data = d.data();
      out.push({
        id: d.id,
        callId: data.callId,
        sender: data.sender,
        message: data.message,
        timestamp: data.timestamp,
      });
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`   fetched ${out.length} so far...`);
    if (snap.size < pageSize) break;
  }
  console.log(`✅ Fetched ${out.length} total docs`);
  return out;
}

interface DedupePlan {
  scanned: number;
  groupsTotal: number;
  groupsWithDupes: number;
  toDelete: string[];
}

function planDedupe(docs: MsgDoc[]): DedupePlan {
  const groups = new Map<string, MsgDoc[]>();
  let malformed = 0;
  for (const d of docs) {
    if (!d.callId || !d.sender || d.message == null) {
      malformed++;
      continue;
    }
    const key = `${d.callId}__${d.sender}__${d.message}`;
    const arr = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }
  const toDelete: string[] = [];
  let groupsWithDupes = 0;
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    groupsWithDupes++;
    // Earliest timestamp wins; everything else queued for deletion.
    arr.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
    for (let i = 1; i < arr.length; i++) toDelete.push(arr[i].id);
  }
  if (malformed > 0) {
    console.warn(
      `⚠️ ${malformed} docs missing callId/sender/message — preserved (not deduped).`,
    );
  }
  return {
    scanned: docs.length,
    groupsTotal: groups.size,
    groupsWithDupes,
    toDelete,
  };
}

async function commitDeletes(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.delete(db.doc(`${COLLECTION}/${id}`));
    }
    await batch.commit();
    const n = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `🗑️  Batch ${n}: deleted ${chunk.length} (total ${i + chunk.length}/${ids.length})`,
    );
  }
}

async function main() {
  console.log(`🚀 Conversation dedupe starting`);
  console.log(`   FIREBASE_PROJECT_ID = ${FIREBASE_PROJECT_ID}`);
  console.log(`   COLLECTION          = ${COLLECTION}`);
  console.log(`   DRY_RUN             = ${args.dryRun}`);
  console.log(`   PAGE_SIZE           = ${args.pageSize}`);
  console.log("");

  const docs = await fetchAll(args.pageSize);
  const plan = planDedupe(docs);

  console.log("");
  console.log(`📊 Plan:`);
  console.log(`   scanned          ${plan.scanned}`);
  console.log(`   unique groups    ${plan.groupsTotal}`);
  console.log(`   groups w/ dupes  ${plan.groupsWithDupes}`);
  console.log(`   docs to delete   ${plan.toDelete.length}`);
  console.log(
    `   net after        ${plan.scanned - plan.toDelete.length} docs`,
  );
  console.log("");

  if (args.dryRun) {
    console.log(`🧪 DRY RUN — no deletes performed`);
    Deno.exit(0);
  }

  if (plan.toDelete.length === 0) {
    console.log(`✨ Nothing to delete`);
    Deno.exit(0);
  }

  await commitDeletes(plan.toDelete);
  console.log("");
  console.log(`🎉 Done — deleted ${plan.toDelete.length} duplicate docs`);
  Deno.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  Deno.exit(1);
});
