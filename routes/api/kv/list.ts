import { define } from "@/utils.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import {
  legacyKeyToCollectionPath,
  reconstructLegacyKey,
} from "@shared/firestore/legacy-key-map.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { prefix?: unknown; limit?: unknown }
      | null;
    if (!body || !Array.isArray(body.prefix)) {
      return Response.json({ error: "Body must be {prefix: [...]}" }, { status: 400 });
    }
    const prefix = body.prefix as Array<string | number>;
    const mapped = legacyKeyToCollectionPath(prefix);
    if (!mapped) {
      return Response.json(
        { error: `Unsupported prefix shape: ${JSON.stringify(prefix)}` },
        { status: 400 },
      );
    }
    const limit = typeof body.limit === "number" ? body.limit : 1000;
    const all = await getFirestoreClient().list(mapped.parent, { limit });
    const filtered = mapped.filterFn ? all.filter((e) => mapped.filterFn!(e.id)) : all;
    return Response.json({
      entries: filtered.map((e) => ({
        key: reconstructLegacyKey(prefix, e.id),
        value: e.data,
      })),
    });
  },
});
