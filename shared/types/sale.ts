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
    activatedAt: string;
    withinDays: number;
  }>;
  // Phones that had at least one appointment record but no candidate fell
  // inside the 7-day window. Always included — small set, near-miss visibility.
  skippedInWindow: Array<{
    phone10: string;
    activatedAt: string;
    candidates: Array<{ appointmentAt: string; daysDiff: number }>;
  }>;
  // Phones in the QB report with NO appointment record on our side.
  // Only populated when `verbose: true` is passed in the request body
  // (otherwise huge — can be 25k+ entries).
  skippedNoInjectionList?: Array<{ phone10: string; activatedAt: string }>;
}
