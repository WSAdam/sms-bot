// Module barrel for `reporting` (nightly report, email, audit markers, canary).
export {
  type DailyReportCounts,
  type NightlyReportOptions,
  type NightlyReportResult,
  runNightlyReport,
  yesterdayEasternDateString,
} from "@reporting/domain/business/nightly/mod.ts";
export {
  sendReport,
  type SendReportParams,
  setPostmarkClientForTests,
} from "@reporting/domain/data/postmark/mod.ts";
export {
  checkAuditMarker,
  sanitizeStage,
  saveAuditMarker,
  type SaveOpts,
} from "@reporting/domain/business/audit/mod.ts";
export {
  type CanaryError,
  gatherHardErrorsForYesterday,
  type HardErrorsReport,
} from "@reporting/domain/business/canary/mod.ts";
