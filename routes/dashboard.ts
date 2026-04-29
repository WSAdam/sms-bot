import { define } from "@/utils.ts";
import { dashboardHtml } from "@shared/ui/pages.ts";

export const handler = define.handlers({
  GET() {
    return new Response(dashboardHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
