// Module barrel for `dialer` (ReadyMode integration: the live trigger →
// inject/scrub path, TPI attempts lookup, portal call-log scrape + daily
// disposition import). Re-exports are allowed ONLY in mod-root.ts per
// barrel-discipline.

// data — external ReadyMode adapters
export * from "@dialer/domain/data/rm-auth/mod.ts";
export * from "@dialer/domain/data/portal-client/mod.ts";
export * from "@dialer/domain/data/tpi-client/mod.ts";

// business — config tables, mapping, validation, and the lead service
export * from "@dialer/domain/business/campaigns/mod.ts";
export * from "@dialer/domain/business/domain-config/mod.ts";
export * from "@dialer/domain/business/mapping/mod.ts";
export * from "@dialer/domain/business/validate-trigger/mod.ts";
export * from "@dialer/domain/business/import-dispositions/mod.ts";
export * from "@dialer/domain/business/scrape-orchestrator/mod.ts";
export * from "@dialer/domain/business/lead-service/mod.ts";
