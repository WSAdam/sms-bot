export type SaleMatchReason = "within_window" | "odr_activator";

export interface SaleWithinWindowMarker {
  phone10: string;
  phone11: string;
  appointmentAt: string | null;
  saleAt: string;
  windowDays: number;
  withinDays: number | null;
  matchReason: SaleMatchReason;
  activator?: string | null;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface ActivateFromReportSummary {
  success: true;
  fetchedFromReport: number;
  matched: number;
  matchedByOdr: number;
  skippedNoInjection: number;
  skippedOlderThan7Days: number;
  matches: Array<{
    phone10: string;
    appointmentAt: string | null;
    activatedAt: string;
    withinDays: number | null;
    matchReason: SaleMatchReason;
    activator?: string | null;
  }>;
  // Phones that had at least one appointment record but no candidate fell
  // inside the configured window. Always included — small set, near-miss
  // visibility.
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
