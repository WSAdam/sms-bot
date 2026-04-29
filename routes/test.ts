import { define } from "@/utils.ts";
import { testPageHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(testPageHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
