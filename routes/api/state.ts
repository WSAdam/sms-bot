import { define } from "@/utils.ts";
import { configStateDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

export const handler = define.handlers({
  async GET() {
    const value = await getFirestoreClient().get(configStateDocPath());
    return Response.json({ value });
  },
});
