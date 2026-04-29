import { define } from "@/utils.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const { phone } = ctx.params as { phone: string };
    const pointer = await orchestrator.getPointer(phone);
    if (!pointer) {
      return Response.json({ error: `No pointer found for ${phone}` }, { status: 404 });
    }
    return Response.json(pointer);
  },
});
