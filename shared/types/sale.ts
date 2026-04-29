export interface SaleWithinWindowMarker {
  phone10: string;
  phone11: string;
  appointmentAt: string;
  saleAt: string;
  windowDays: number;
  withinDays: number;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface ActivateFromReportSummary {
  success: true;
  fetchedFromReport: number;
  matched: number;
  skippedNoInjection: number;
  skippedOlderThan7Days: number;
  matches: Array<{
    phone10: string;
    appointmentAt: string;
    withinDays: number;
  }>;
}
