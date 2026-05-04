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

export interface BookingRow {
  phone10: string;
  phoneRaw: string;
  addedDate: string | null;
}

// Auto-detect phone + date column IDs from the report's fields metadata.
// Different QB reports use different field IDs (e.g. 530: phone=48 date=-1,
// 678: phone=-1 date=8), so we can't hardcode them. Falls back to the
// report-530 IDs only when no field metadata is present (legacy callers).
import type { QuickbaseField } from "@shared/services/quickbase/client.ts";

function findPhoneField(fields: QuickbaseField[]): QuickbaseField | undefined {
  return fields.find((f) => (f.type ?? "").toLowerCase() === "phone") ??
    fields.find((f) => /phone/i.test(f.label ?? ""));
}

function findDateField(fields: QuickbaseField[]): QuickbaseField | undefined {
  return fields.find((f) => (f.type ?? "").toLowerCase() === "date") ??
    fields.find((f) => /date|added|arrival|activated/i.test(f.label ?? ""));
}

export interface NormalizationResult {
  rows: BookingRow[];
  phoneFieldId: string;
  dateFieldId: string | null;
}

export function normalizeBookingRowsDetailed(
  resp: QuickbaseReportResponse,
): NormalizationResult {
  const fields = resp.fields ?? [];
  const phoneF = findPhoneField(fields);
  const dateF = findDateField(fields);
  // Fall back to report-530 schema if metadata is absent.
  const phoneKey = phoneF ? String(phoneF.id) : "48";
  const dateKey = dateF ? String(dateF.id) : "-1";

  const rows: BookingRow[] = [];
  for (const r of resp.data ?? []) {
    const rawPhone = r[phoneKey]?.value;
    const addedRaw = r[dateKey]?.value;
    if (typeof rawPhone !== "string") continue;
    const digits = rawPhone.replace(/\D/g, "");
    if (digits.length < 10) continue;
    rows.push({
      phone10: digits.slice(-10),
      phoneRaw: rawPhone,
      addedDate: typeof addedRaw === "string" ? addedRaw : null,
    });
  }
  return { rows, phoneFieldId: phoneKey, dateFieldId: dateF ? dateKey : null };
}

// Backwards-compat alias for the existing call sites + tests.
export function normalizeBookingRows(
  resp: QuickbaseReportResponse,
): BookingRow[] {
  return normalizeBookingRowsDetailed(resp).rows;
}
