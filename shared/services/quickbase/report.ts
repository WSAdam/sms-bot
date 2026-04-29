// Calls the public Cloud Function `getReports` which fronts a Quickbase
// table+report fetch. Auth is via the `test` body field (shared secret).
//
// Endpoint shape:
//   POST https://us-central1-crm-sdk.cloudfunctions.net/getReports
//   body: { test: <env QUICKBASE_REPORT_TOKEN>, tableID, reportID }

import { QUICKBASE_GET_REPORTS_URL } from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";
import type { QuickbaseReportResponse } from "@shared/services/quickbase/client.ts";

export async function realGetReport(
  tableID: string,
  reportID: string,
): Promise<QuickbaseReportResponse> {
  const env = loadEnv();
  if (!env.quickbaseReportToken) {
    throw new Error(
      "Missing QUICKBASE_REPORT_TOKEN — required for getReport().",
    );
  }

  // Single retry on 5xx; never on 4xx.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(QUICKBASE_GET_REPORTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test: env.quickbaseReportToken,
          tableID,
          reportID,
        }),
      });

      if (res.ok) {
        return await res.json() as QuickbaseReportResponse;
      }
      const text = await res.text();
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Quickbase getReport ${res.status}: ${text.slice(0, 200)}`);
      }
      lastErr = new Error(`Quickbase getReport ${res.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Field 48 in the bookings report is a phone like "(936) 676-2277".
// Field -1 is the date the row was added (YYYY-MM-DD).
export interface BookingRow {
  phone10: string;
  phoneRaw: string;
  addedDate: string | null;
}

export function normalizeBookingRows(
  resp: QuickbaseReportResponse,
): BookingRow[] {
  const rows: BookingRow[] = [];
  for (const r of resp.data ?? []) {
    const rawPhone = (r["48"] ?? r[48 as unknown as string])?.value;
    const addedRaw = (r["-1"] ?? r[-1 as unknown as string])?.value;
    if (typeof rawPhone !== "string") continue;
    const digits = rawPhone.replace(/\D/g, "");
    if (digits.length < 10) continue;
    rows.push({
      phone10: digits.slice(-10),
      phoneRaw: rawPhone,
      addedDate: typeof addedRaw === "string" ? addedRaw : null,
    });
  }
  return rows;
}
