// Returns the cached ReadyMode campaign-id-to-name map. Populated by the
// daily readymode-daily-pull cron (and the manual /api/admin/pull-readymode
// endpoint) — we ingest the campaignlist payload that comes back with
// every Call Log Report fetch.
//
// Used by the dashboard's Activated Guests modal to render the "Campaign"
// column from leadpointer.originalSource.campaignId.

import { define } from "@/utils.ts";
import { readymodeCampaignsDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

export const handler = define.handlers({
  async GET() {
    const doc = await getFirestoreClient().get(readymodeCampaignsDocPath());
    return Response.json({
      campaigns: (doc?.campaigns ?? {}) as Record<string, string>,
      updatedAt: typeof doc?.updatedAt === "string"
        ? doc.updatedAt
        : null,
    });
  },
});
