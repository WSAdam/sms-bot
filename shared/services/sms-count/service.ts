// MIGRATION SHIM → sms-count moved to src/core/business/sms-count during the
// shape-checker migration. Kept so existing importers keep working untouched.
export * from "@core/business/sms-count/mod.ts";
