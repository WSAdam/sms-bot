// Composite-index probe. Fires one representative query per composite
// index defined in firestore.indexes.json. Used at deploy time so the
// operator can:
//   1. Click the test-page button → see the Firestore "create this
//      index" URL in the response.
//   2. Open the URL → confirm the auto-generated index spec →
//      "Save" (Firestore builds in the background).
//   3. Wait a few minutes → click the button again → see real results
//      instead of an error.
//
// Each probe runs against the smallest possible query (limit 1) so the
// "ready" response is fast and cheap.
//
// Why we don't just `firebase deploy --only firestore:indexes`:
// that works too, but the operator already lives in the Test page —
// one-click-per-index is faster than context-switching to gcloud + the
// Firebase console.
//
// Usage:
//   GET /api/admin/probe-index?name=<probeId>
//
// Probe names:
//   - "messages-phone-timestamp"   — drill.ts filter by phoneNumber
//   - "messages-sender-timestamp"  — drill.ts filter by sender
//   - "messages-nodeTag-timestamp" — drill.ts filter by nodeTag
//                                    + repopulate-injections.ts

import { define } from "@/utils.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

interface ProbeSpec {
  description: string;
  where: { field: string; op: "=="; value: string };
  orderBy: { field: string; dir: "asc" | "desc" };
  parentPath: string;
}

const PROBES: Record<string, ProbeSpec> = {
  "messages-phone-timestamp": {
    description:
      "drill.ts filter by phoneNumber + orderBy(timestamp desc) — composite (phoneNumber asc, timestamp desc)",
    where: { field: "phoneNumber", op: "==", value: "8432222986" },
    orderBy: { field: "timestamp", dir: "desc" },
    parentPath: conversationsCollection,
  },
  "messages-sender-timestamp": {
    description:
      "drill.ts filter by sender + orderBy(timestamp desc) — composite (sender asc, timestamp desc)",
    where: { field: "sender", op: "==", value: "Guest" },
    orderBy: { field: "timestamp", dir: "desc" },
    parentPath: conversationsCollection,
  },
  "messages-nodeTag-timestamp": {
    description:
      "drill.ts + repopulate-injections.ts filter by nodeTag + orderBy(timestamp desc) — composite (nodeTag asc, timestamp desc)",
    where: { field: "nodeTag", op: "==", value: "appointment scheduled" },
    orderBy: { field: "timestamp", dir: "desc" },
    parentPath: conversationsCollection,
  },
};

// Firestore's FAILED_PRECONDITION error message contains the auto-create
// URL — strip it out so the response is a single clickable link. The
// URL format is stable: https://console.firebase.google.com/v1/r/project/
// {projectId}/firestore/indexes?create_composite=<base64>
const CREATE_URL_RE =
  /https:\/\/console\.firebase\.google\.com\/v1\/r\/project\/[^\s]+create_composite=[A-Za-z0-9_-]+/;

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const name = url.searchParams.get("name") ?? "";
    const spec = PROBES[name];
    if (!spec) {
      return Response.json({
        status: "error",
        message: `Unknown probe name "${name}". Known probes: ${
          Object.keys(PROBES).join(", ")
        }`,
        availableProbes: Object.entries(PROBES).map(([id, s]) => ({
          id,
          description: s.description,
        })),
      }, { status: 400 });
    }

    const db = getFirestoreClient();
    const t0 = performance.now();
    try {
      const results = await db.list(spec.parentPath, {
        where: spec.where,
        orderBy: spec.orderBy,
        limit: 1,
      });
      const ms = Math.round(performance.now() - t0);
      console.log(
        `[probe-index] ✅ ${name} ready — ${results.length} doc(s) in ${ms}ms`,
      );
      return Response.json({
        status: "ready",
        name,
        description: spec.description,
        elapsedMs: ms,
        sampleCount: results.length,
        sample: results.map((r) => ({ id: r.id, data: r.data })),
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const isPrecondition = msg.includes("FAILED_PRECONDITION") ||
        msg.includes("requires an index");
      if (isPrecondition) {
        const m = msg.match(CREATE_URL_RE);
        const createUrl = m ? m[0] : null;
        console.warn(
          `[probe-index] 🟡 ${name} needs index — ${
            createUrl ?? "(no URL in error)"
          }`,
        );
        return Response.json({
          status: "index_needed",
          name,
          description: spec.description,
          createUrl,
          rawError: msg.slice(0, 600),
          nextSteps: createUrl
            ? "Click the createUrl link. Save the index in the Firebase console. Wait for the build to complete (Firestore console → Indexes tab → status 'Enabled'). Then click the button again to verify."
            : "Firestore returned FAILED_PRECONDITION but no URL was in the error. Check the Firestore Indexes tab manually.",
        });
      }
      console.error(`[probe-index] ❌ ${name} unexpected error: ${msg}`);
      return Response.json({
        status: "error",
        name,
        description: spec.description,
        message: msg.slice(0, 600),
      }, { status: 500 });
    }
  },
});
