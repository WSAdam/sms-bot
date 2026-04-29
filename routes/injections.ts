import { define } from "@/utils.ts";
import { injectionsPageHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(injectionsPageHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
