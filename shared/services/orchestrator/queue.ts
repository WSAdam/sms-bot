// MIGRATION SHIM → the delayed-injection handler moved to
// src/sms-flow/domain/business/delayed-injection during the shape-checker
// migration. Kept so existing importers keep working untouched.
export * from "@sms-flow/domain/business/delayed-injection/mod.ts";
