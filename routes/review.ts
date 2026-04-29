import { define } from "@/utils.ts";
import { reviewPageHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(reviewPageHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
