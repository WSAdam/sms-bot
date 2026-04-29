import { define } from "@/utils.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { legacyKeyToDocPath } from "@shared/firestore/legacy-key-map.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const url = new URL(ctx.req.url);
    const raw = url.searchParams.get("key");
    if (!raw) return Response.json({ error: "Missing key" }, { status: 400 });

    let key: unknown;
    try {
      key = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid key JSON" }, { status: 400 });
    }
    if (!Array.isArray(key)) {
      return Response.json({ error: "Key must be an array" }, { status: 400 });
    }
    const mapped = legacyKeyToDocPath(key as Array<string | number>);
    if (!mapped) {
      return Response.json(
        { error: `Unsupported key shape: ${JSON.stringify(key)}` },
        { status: 400 },
      );
    }
    await getFirestoreClient().delete(mapped.path);
    return Response.json({ success: true });
  },
});
