// Quickbase client interface. Real impls live in:
//   report.ts        → public Cloud Function `getReports`
//   reservations.ts  → direct REST API for reservation lookups + DNC
//
// Wire-up: the default export from this file is the production client.
// Tests pass their own implementation directly via setQuickbaseClientForTests.

import { realGetReport } from "@shared/services/quickbase/report.ts";
import {
  findByResId,
  isDncByPhone,
  markDncByPhone,
} from "@shared/services/quickbase/reservations.ts";

export interface QuickbaseField {
  id: number | string;
  label: string;
  type: string;
}

export interface QuickbaseReportResponse {
  data: Array<Record<string, { value: unknown }>>;
  fields?: QuickbaseField[];
  metadata?: { numFields?: number; numRecords?: number; totalRecords?: number; skip?: number };
}

export interface ReservationLookup {
  ReservationId: number;
  GuestFullName: string;
  SpouseFullName: string;
  SpouseName: string;
  AskTcpaVerbiage: string;
  EmailAddress: string;
  Dnc: boolean;
  MostRecentPackageIdDateOfBooking: string;
  MostRecentPackageIdCreditCardType: string;
  MostRecentPackageIdLast4OfCreditCardOnly: string;
}

export interface QuickbaseClient {
  getReport(tableID: string, reportID: string): Promise<QuickbaseReportResponse>;
  findReservationByResID(resId: number): Promise<ReservationLookup | null>;
  markDNC(phone: string): Promise<{ success: boolean }>;
  isDNC(phone: string): Promise<boolean>;
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `QuickbaseClient.${method} is not implemented yet. ` +
        `Provide a real client (or replace shared/services/quickbase/stub.ts).`,
    );
    this.name = "NotImplementedError";
  }
}

class DefaultQuickbaseClient implements QuickbaseClient {
  getReport(tableID: string, reportID: string) {
    return realGetReport(tableID, reportID);
  }
  findReservationByResID(resId: number) {
    return findByResId(resId);
  }
  markDNC(phone: string) {
    return markDncByPhone(phone);
  }
  isDNC(phone: string) {
    return isDncByPhone(phone);
  }
}

let cached: QuickbaseClient | null = null;

export function getQuickbaseClient(): QuickbaseClient {
  if (!cached) cached = new DefaultQuickbaseClient();
  return cached;
}

export function setQuickbaseClientForTests(c: QuickbaseClient | null): void {
  cached = c;
}
