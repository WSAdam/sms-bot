// Dashboard drill-in. The legacy endpoint takes a stat-card name and
// optional date range. We support a subset of cards that map cleanly to
// Firestore subcollections.

import { define } from "@/utils.ts";
import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const CARD_TO_PREFIX: Record<string, string> = {
  textsSent: `${ROOT_COLLECTION}/conversations/messages`,
  initialTextsSent: `${ROOT_COLLECTION}/conversations/messages`,
  peopleReplied: `${ROOT_COLLECTION}/conversations/messages`,
  appointmentsSet: `${ROOT_COLLECTION}/scheduledinjections/byPhone`,
  activated: `${ROOT_COLLECTION}/guestactivated/byPhone`,
  answered: `${ROOT_COLLECTION}/guestanswered/byPhone`,
};

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const card = url.searchParams.get("card") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 100);

    const parent = CARD_TO_PREFIX[card];
    if (!parent) {
      return Response.json({ error: `unknown card: ${card}` }, { status: 400 });
    }
    const entries = await getFirestoreClient().list(parent, { limit });
    return Response.json({ entries: entries.map((e) => ({ id: e.id, value: e.data })) });
  },
});
