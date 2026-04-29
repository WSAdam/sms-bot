// Typed reservation lookups + DNC helpers backed by the Quickbase REST API.
// Replaces the stub implementations of findReservationByResID / isDNC / markDNC.

import {
  QB_RES_FIELD,
  QB_RESERVATIONS_TABLE,
} from "@shared/config/constants.ts";
import {
  type QbRecord,
  queryRecords,
  upsertRecords,
} from "@shared/services/quickbase/api.ts";
import type { ReservationLookup } from "@shared/services/quickbase/client.ts";

const SELECT_FIELDS = [
  QB_RES_FIELD.ReservationId,
  QB_RES_FIELD.GuestFullName,
  QB_RES_FIELD.SpouseFullName,
  QB_RES_FIELD.EmailAddress,
  QB_RES_FIELD.Phone,
  QB_RES_FIELD.Dnc,
  QB_RES_FIELD.AskTcpaVerbiage,
];

// QB stores phones formatted as "(843) 222-2986". Convert phone10 → that
// format so we can query with EX. (Phone-typed fields in QB compare by their
// display string for `EX`.)
export function formatPhoneForQb(phone10: string): string {
  if (phone10.length !== 10) return phone10;
  return `(${phone10.slice(0, 3)}) ${phone10.slice(3, 6)}-${phone10.slice(6)}`;
}

function fieldString(rec: QbRecord, fid: number): string {
  const v = rec[String(fid)]?.value;
  return v == null ? "" : String(v);
}

function fieldBool(rec: QbRecord, fid: number): boolean {
  const v = rec[String(fid)]?.value;
  return v === true || v === "true" || v === 1;
}

function mapToLookup(rec: QbRecord): ReservationLookup {
  return {
    ReservationId: Number(fieldString(rec, QB_RES_FIELD.ReservationId)) || 0,
    GuestFullName: fieldString(rec, QB_RES_FIELD.GuestFullName),
    SpouseFullName: fieldString(rec, QB_RES_FIELD.SpouseFullName),
    SpouseName: fieldString(rec, QB_RES_FIELD.SpouseFullName),
    AskTcpaVerbiage: fieldString(rec, QB_RES_FIELD.AskTcpaVerbiage),
    EmailAddress: fieldString(rec, QB_RES_FIELD.EmailAddress),
    Dnc: fieldBool(rec, QB_RES_FIELD.Dnc),
    // Package fields require a follow-up query against bttffb64u — left empty
    // for now. Add when the Bland pathway needs them.
    MostRecentPackageIdDateOfBooking: "",
    MostRecentPackageIdCreditCardType: "",
    MostRecentPackageIdLast4OfCreditCardOnly: "",
  };
}

export async function findByResId(
  resId: number,
): Promise<ReservationLookup | null> {
  if (!Number.isFinite(resId) || resId <= 0) return null;
  const records = await queryRecords({
    tableId: QB_RESERVATIONS_TABLE,
    where: `{${QB_RES_FIELD.ReservationId}.EX.'${resId}'}`,
    select: SELECT_FIELDS,
  });
  return records[0] ? mapToLookup(records[0]) : null;
}

export async function findByPhone(
  phone10: string,
): Promise<ReservationLookup | null> {
  const formatted = formatPhoneForQb(phone10);
  const records = await queryRecords({
    tableId: QB_RESERVATIONS_TABLE,
    where: `{${QB_RES_FIELD.Phone}.EX.'${formatted}'}`,
    select: SELECT_FIELDS,
  });
  return records[0] ? mapToLookup(records[0]) : null;
}

export async function isDncByPhone(phone10: string): Promise<boolean> {
  const r = await findByPhone(phone10);
  return r ? r.Dnc : false;
}

export async function markDncByPhone(
  phone10: string,
): Promise<{ success: boolean; reason?: string }> {
  const r = await findByPhone(phone10);
  if (!r || !r.ReservationId) {
    return { success: false, reason: "no reservation found for phone" };
  }
  await upsertRecords({
    tableId: QB_RESERVATIONS_TABLE,
    data: [{
      [String(QB_RES_FIELD.ReservationId)]: { value: r.ReservationId },
      [String(QB_RES_FIELD.Dnc)]: { value: true },
    }],
    mergeFieldId: QB_RES_FIELD.ReservationId,
  });
  return { success: true };
}
