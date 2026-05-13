// Dev tool: snapshot of the TPI throttle state. Lets the operator see
// the current 5-min window usage, ms since last call, and circuit state
// without needing to tail logs.
//
// GET /api/test/tpi/status

import { define } from "@/utils.ts";
import { getTpiThrottleSnapshot } from "@shared/services/readymode/tpi-client.ts";

export const handler = define.handlers({
  GET() {
    return Response.json(getTpiThrottleSnapshot());
  },
});
