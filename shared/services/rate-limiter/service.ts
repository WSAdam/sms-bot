// MIGRATION SHIM → moved to src/sms-flow during the shape-checker migration.
// Kept so existing shared/services/rate-limiter/service.ts importers keep working untouched. (Lives in the
// untracked shared/ tree, so this re-export isn't shape-checked.)
export * from "@sms-flow/domain/business/rate-limiter/mod.ts";
