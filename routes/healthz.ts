import { define } from "@/utils.ts";

export const handler = define.handlers({
  GET() {
    return Response.json({
      ok: true,
      service: "sms-bot",
      time: new Date().toISOString(),
    });
  },
});
