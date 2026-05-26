// Live-editable gates config endpoint. Powers the "Gates" card on the
// test page + the explainer panel at the top of the dashboard. Adam can
// change the attempts threshold, sale-match window, global daily SMS cap,
// and per-phone rate-limit window from the dashboard without redeploying.
//
// The inbound-window gate is NOT live-editable — it's env-driven (see
// shared/config/env.ts) so the /trigger/readymode handler can decide
// without any Firestore read. The GET response includes the current
// env-derived state under `inboundWindow.*` so the form can display it
// as read-only.
//
// GET  → current merged config + env-derived inbound window
// POST → merge body into current and save (Firestore-stored fields only)

import { define } from "@/utils.ts";
import { loadEnv } from "@shared/config/env.ts";
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
    const env = loadEnv();
    const todayEt = easternDateString();
    // Compute today's effective window from the env-driven mode +
    // explicit start/end. UI displays this as the source of truth.
    const currentEffectiveWindow = effectiveInboundWindow(
      env.inboundWindowMode,
      env.inboundWindowStartEt,
      env.inboundWindowEndEt,
      todayEt,
    );
    return Response.json({
      ...config,
      inboundWindow: {
        mode: env.inboundWindowMode,
        explicitStartEt: env.inboundWindowStartEt,
        explicitEndEt: env.inboundWindowEndEt,
        currentEffectiveWindow,
        currentTodayEt: todayEt,
        source: "env",
      },
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
