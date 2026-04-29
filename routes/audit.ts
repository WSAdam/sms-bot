import { define } from "@/utils.ts";
import { auditSearchHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(auditSearchHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
