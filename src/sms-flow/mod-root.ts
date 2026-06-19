// Module barrel for `sms-flow` (the trigger/opt-in pipeline). Re-exports are
// allowed ONLY in mod-root.ts (and poly-mod.ts / bootstrap) per barrel-discipline.
export {
  getAndToggleVariant,
  type Variant,
} from "@sms-flow/domain/business/ab-test/mod.ts";
export {
  checkOnly,
  reserve,
  schedule,
} from "@sms-flow/domain/business/rate-limiter/mod.ts";
export { isDnc, markDnc } from "@sms-flow/domain/business/dnc/mod.ts";
export {
  getContext,
  saveContext,
} from "@sms-flow/domain/data/flow-context/mod.ts";
export {
  getEvents,
  getPointer,
  logEvent,
  updatePointer,
} from "@sms-flow/domain/data/orchestrator-store/mod.ts";
export {
  handleDelayedInjection,
  type HandleDelayedInjectionResult,
} from "@sms-flow/domain/business/delayed-injection/mod.ts";
