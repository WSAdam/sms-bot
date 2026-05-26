// Live-editable gates config endpoint. Powers the "Gates" card on the
// test page + the explainer panel at the top of the dashboard. Adam can
// change the attempts threshold, sale-match window, global daily SMS cap,
// and per-phone rate-limit window from the dashboard without redeploying.
//
// GET  → current merged config (Firestore doc overrides shipped defaults)
// POST → merge body into current and save

import { define } from "@/utils.ts";
import {
  type GatesConfig,
  getGatesConfig,
  setGatesConfig,
} from "@shared/services/config/gates-config.ts";
import {
  easternDateString,
  effectiveInboundWindow,
} from "@shared/util/time.ts";

export const handler = define.handlers({
  async GET() {
    const config = await getGatesConfig();
    // Surface today's effective inbound window so the form can show
    // it (especially valuable in random mode where the actual window
    // isn't visible from the raw fields). Computed, not stored.
    const todayEt = easternDateString();
    const currentEffectiveWindow = effectiveInboundWindow(
      config.inboundWindowMode,
      config.inboundWindowStartEt,
      config.inboundWindowEndEt,
      todayEt,
    );
    return Response.json({
      ...config,
      currentEffectiveWindow,
      currentTodayEt: todayEt,
    });
  },
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | Partial<
        Pick<
          GatesConfig,
          | "attemptsThreshold"
          | "saleMatchWindowDays"
          | "globalDailySmsCap"
          | "rateLimitWindowDays"
          | "costPerText"
          | "earningsPerSale"
          | "tpiMinSpacingMs"
          | "tpiMaxPer5Min"
          | "scheduledInjectionSweepEnabled"
          | "scheduledInjectionDedupHours"
          | "inboundWindowMode"
          | "inboundWindowStartEt"
          | "inboundWindowEndEt"
        >
      >
      | null;
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const updated = await setGatesConfig(body);
    return Response.json(updated);
  },
});
