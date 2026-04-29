import { define } from "@/utils.ts";
import { searchPageHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(searchPageHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
