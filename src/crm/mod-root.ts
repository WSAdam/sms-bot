// Module barrel for `crm` (Quickbase CRM + sale matching).
export {
  type QbQueryOptions,
  type QbRecord,
  type QbUpsertOptions,
  queryRecords,
  upsertRecords,
} from "@crm/domain/data/qb-api/mod.ts";
export {
  getQuickbaseClient,
  NotImplementedError,
  type QuickbaseClient,
  type QuickbaseField,
  type QuickbaseReportResponse,
  type ReservationLookup,
  setQuickbaseClientForTests,
} from "@crm/domain/data/qb-client/mod.ts";
export {
  type BookingRow,
  type NormalizationResult,
  normalizeBookingRows,
  normalizeBookingRowsDetailed,
  realGetReport,
} from "@crm/domain/data/qb-report/mod.ts";
export {
  findByPhone,
  findByResId,
  formatPhoneForQb,
  isDncByPhone,
  markDncByPhone,
} from "@crm/domain/data/qb-reservations/mod.ts";
export { findGuestByResId } from "@crm/domain/business/crm-lookup/mod.ts";
export {
  processSaleMatches,
  type ProcessSaleMatchOptions,
  type SaleMatchInput,
} from "@crm/domain/business/sale-match/mod.ts";
export {
  type DailyCronResult,
  runDailyQbSaleMatch,
} from "@crm/domain/business/sale-match-cron/mod.ts";
