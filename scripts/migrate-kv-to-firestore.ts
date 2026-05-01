// migrate-kv-to-firestore.ts
//
// One-shot migration: pulls every record from the existing Deno KV deploy
// (via its HTTP `/api/kv/list` endpoint) and writes the equivalent docs into
// Firestore under the single root collection `sms-bot`.
//
// The new sms-bot Deno Deploy app will write to Firestore from day 1; this
// script only exists to seed historical data so the dashboards/sale-match
// flow have something to work with on day 1.
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   FIREBASE_PROJECT_ID=your-project-id \
//   SOURCE_KV_URL=https://google-sheets-kv.thetechgoose.deno.net \
//   deno run -A scripts/migrate-kv-to-firestore.ts [--dry-run] [--prefix=<name>] [--limit=<n>]
//
// Flags:
//   --dry-run           Log what would be written, but commit nothing.
//   --prefix=<name>     Only migrate this one KV prefix (e.g. conversations).
//   --limit=<n>         Max entries to fetch per prefix (default 10000).

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

interface KvEntry {
  key: unknown[];
  value: Record<string, unknown> | null;
  versionstamp?: string;
}

interface FirestoreWrite {
  path: string;
  data: Record<string, unknown>;
  sourceKey: unknown[];
}

interface Args {
  dryRun: boolean;
  prefix?: string;
  limit: number;
}

const ROOT_COLLECTION = "sms-bot";

const PREFIXES = [
  "conversations",
  "scheduledinjection",
  "smsflowcontext",
  "guestactivated",
  "guestanswered",
  "audit",
  "auditstage",
  "audit_stage",
  "saleswithin7d",
  "injectionhistory",
  "config",
];

function parseArgs(rawArgs: string[]): Args {
  const out: Args = { dryRun: false, limit: 10000 };
  for (const a of rawArgs) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--prefix=")) out.prefix = a.slice("--prefix=".length);
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice("--limit=".length), 10);
  }
  return out;
}

const args = parseArgs(Deno.args);

const SOURCE_KV_URL = Deno.env.get("SOURCE_KV_URL") ||
  "https://google-sheets-kv.thetechgoose.deno.net";
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID");
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");

if (!FIREBASE_PROJECT_ID) {
  console.error("❌ Missing FIREBASE_PROJECT_ID env var");
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

function sanitizeDocId(s: string): string {
  // Firestore doc IDs cannot contain '/', cannot be '.' or '..', cannot match /__.*__/
  // and have a 1500-byte limit. Replace problem chars defensively.
  let safe = s.replace(/\//g, "_");
  if (safe === "." || safe === "..") safe = "_dot_";
  if (/^__.*__$/.test(safe)) safe = `x${safe}x`;
  if (safe.length > 1500) safe = safe.slice(0, 1500);
  return safe;
}

function joinKeyParts(...parts: unknown[]): string {
  return parts.map((p) => sanitizeDocId(String(p ?? ""))).join("__");
}

async function fetchKvPrefix(prefix: string, limit: number): Promise<KvEntry[]> {
  console.log(`🔍 [${prefix}] Fetching from ${SOURCE_KV_URL}/api/kv/list (limit=${limit})...`);
  const res = await fetch(`${SOURCE_KV_URL}/api/kv/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: [prefix], limit }),
  });
  if (!res.ok) {
    throw new Error(`KV list failed for "${prefix}": HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const entries: KvEntry[] = data.entries ?? [];
  console.log(`✅ [${prefix}] Fetched ${entries.length} entries`);
  return entries;
}

function transformEntry(entry: KvEntry): FirestoreWrite | null {
  const [prefix, ...rest] = entry.key;
  const value = (entry.value ?? {}) as Record<string, unknown>;
  const data = { ...value, _kvKey: entry.key };

  switch (prefix) {
    case "conversations": {
      const [phone10, callId, timestamp] = rest;
      return {
        path: `${ROOT_COLLECTION}/conversations/messages/${joinKeyParts(phone10, callId, timestamp)}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "scheduledinjection": {
      const [phone10] = rest;
      return {
        path: `${ROOT_COLLECTION}/scheduledinjections/byPhone/${sanitizeDocId(String(phone10))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "smsflowcontext": {
      const [phone10] = rest;
      return {
        path: `${ROOT_COLLECTION}/smsflowcontext/byPhone/${sanitizeDocId(String(phone10))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "guestactivated": {
      const [phone10] = rest;
      return {
        path: `${ROOT_COLLECTION}/guestactivated/byPhone/${sanitizeDocId(String(phone10))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "guestanswered": {
      const [phone10] = rest;
      return {
        path: `${ROOT_COLLECTION}/guestanswered/byPhone/${sanitizeDocId(String(phone10))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "audit": {
      const [recordId] = rest;
      return {
        path: `${ROOT_COLLECTION}/audit/byRecordId/${sanitizeDocId(String(recordId))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "auditstage":
    // Legacy data also exists under the underscore-form prefix `audit_stage`
    // (786 records, written before the legacy app renamed to `auditstage`).
    // Identical key+value shape, zero recordId overlap with auditstage —
    // safe to merge into the same Firestore collection.
    // deno-lint-ignore no-fallthrough
    case "audit_stage": {
      const [stage, recordId] = rest;
      return {
        path: `${ROOT_COLLECTION}/auditstage/${sanitizeDocId(String(stage))}/${sanitizeDocId(String(recordId))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "saleswithin7d": {
      const [phone10] = rest;
      return {
        path: `${ROOT_COLLECTION}/saleswithin7d/byPhone/${sanitizeDocId(String(phone10))}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "injectionhistory": {
      const [phone10, firedAt] = rest;
      return {
        path: `${ROOT_COLLECTION}/injectionhistory/byPhone/${joinKeyParts(phone10, firedAt)}`,
        data,
        sourceKey: entry.key,
      };
    }
    case "config": {
      const [name] = rest;
      return {
        path: `${ROOT_COLLECTION}/config/settings/${sanitizeDocId(String(name ?? "default"))}`,
        data,
        sourceKey: entry.key,
      };
    }
    default:
      console.warn(`⚠️ Unknown prefix "${prefix}" — skipping (key=${JSON.stringify(entry.key)})`);
      return null;
  }
}

async function migratePrefix(prefix: string, limit: number, dryRun: boolean) {
  const entries = await fetchKvPrefix(prefix, limit);
  if (entries.length === 0) {
    console.log(`⚠️ [${prefix}] No entries to migrate`);
    return { written: 0, skipped: 0 };
  }

  const writes: FirestoreWrite[] = [];
  for (const entry of entries) {
    const w = transformEntry(entry);
    if (w) writes.push(w);
  }

  if (dryRun) {
    console.log(`🧪 [${prefix}] DRY RUN — would write ${writes.length} docs`);
    if (writes.length > 0) {
      console.log(`   Sample path: ${writes[0].path}`);
      const preview = JSON.stringify(writes[0].data).slice(0, 200);
      console.log(`   Sample data: ${preview}${preview.length >= 200 ? "..." : ""}`);
    }
    return { written: 0, skipped: writes.length };
  }

  const BATCH_SIZE = 400; // Firestore batch limit is 500
  let written = 0;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const w of chunk) {
      batch.set(db.doc(w.path), w.data);
    }
    try {
      await batch.commit();
      written += chunk.length;
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`✅ [${prefix}] Batch ${batchNum} committed (${chunk.length} docs, total ${written}/${writes.length})`);
    } catch (err) {
      console.error(`❌ [${prefix}] Batch commit failed at offset ${i}:`, err);
      throw err;
    }
  }

  return { written, skipped: 0 };
}

async function main() {
  console.log(`🚀 KV → Firestore migration starting`);
  console.log(`   SOURCE_KV_URL       = ${SOURCE_KV_URL}`);
  console.log(`   FIREBASE_PROJECT_ID = ${FIREBASE_PROJECT_ID}`);
  console.log(`   ROOT_COLLECTION     = ${ROOT_COLLECTION}`);
  console.log(`   DRY_RUN             = ${args.dryRun}`);
  console.log(`   LIMIT_PER_PREFIX    = ${args.limit}`);
  if (args.prefix) console.log(`   ONLY_PREFIX         = ${args.prefix}`);
  console.log("");

  const targetPrefixes = args.prefix ? [args.prefix] : PREFIXES;
  const totals: Record<string, { written: number; skipped: number }> = {};

  for (const prefix of targetPrefixes) {
    try {
      totals[prefix] = await migratePrefix(prefix, args.limit, args.dryRun);
    } catch (err) {
      console.error(`❌ [${prefix}] Migration failed:`, err);
      totals[prefix] = { written: 0, skipped: 0 };
    }
    console.log("");
  }

  console.log(`🎉 Migration complete:`);
  for (const [p, t] of Object.entries(totals)) {
    console.log(`   ${p.padEnd(20)} ${String(t.written).padStart(6)} written  ${String(t.skipped).padStart(6)} skipped`);
  }
  Deno.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal:", err);
  Deno.exit(1);
});
