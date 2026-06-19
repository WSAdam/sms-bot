// Module barrel for `reporting`. Re-exports are allowed ONLY here (and in
// poly-mod.ts / bootstrap) per shape-checker's barrel-discipline rule.
export {
  getCount,
  increment,
} from "@reporting/domain/business/sms-count/mod.ts";
