import { define } from "@/utils.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { legacyKeyToDocPath } from "@shared/firestore/legacy-key-map.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { key?: unknown; value?: unknown }
      | null;
    if (!body || !Array.isArray(body.key)) {
      return Response.json({ error: "Body must be {key: [...], value: ...}" }, { status: 400 });
    }
    const mapped = legacyKeyToDocPath(body.key as Array<string | number>);
    if (!mapped) {
      return Response.json(
        { error: `Unsupported key shape: ${JSON.stringify(body.key)}` },
        { status: 400 },
      );
    }
    const data = (body.value && typeof body.value === "object")
      ? body.value as Record<string, unknown>
      : { value: body.value };
    await getFirestoreClient().set(mapped.path, data);
    return Response.json({ success: true });
  },
});
