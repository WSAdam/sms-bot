// MIGRATION SHIM → the orchestrator lead pointer + event store moved to
// src/sms-flow/domain/data/orchestrator-store during the shape-checker
// migration. Kept so existing importers keep working untouched.
export * from "@sms-flow/domain/data/orchestrator-store/mod.ts";
