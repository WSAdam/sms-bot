// Maps inbound webhook payloads to a normalized StandardLead, and back to
// per-domain Custom_XX field naming for outbound injection.

import {
  DialerDomain,
  type StandardLead,
} from "@shared/types/readymode.ts";

type FieldMap = Record<keyof StandardLead, string>;

const MAPS: Record<DialerDomain, FieldMap> = {
  [DialerDomain.MONSTER]: {
    phone: "phone",
    firstName: "firstName",
    lastName: "lastName",
    email: "email",
    address: "address",
    city: "city",
    state: "state",
    zip: "zip",
    reservationId: "Custom_1",
    destination: "Custom_2",
    desiredDestination1: "Custom_16",
    desiredDestination2: "Custom_17",
    desiredDate1: "Custom_19",
    desiredDate2: "Custom_20",
    leadDate: "Custom_32",
    resortName: "Custom_18",
    spouseAge: "Custom_27",
    maritalStatus: "Custom_35",
    income: "Custom_25",
    notes: "Custom_21",
    numAdults: "Custom_23",
    numChildren: "Custom_24",
    guestAge: "Custom_26",
    dateOfBooking: "Custom_3",
    office: "Custom_7",
    urlLinkToRecord: "Custom_5",
    totalPrice: "Custom_2",
  },
  [DialerDomain.ACT]: {
    phone: "phone",
    firstName: "firstName",
    lastName: "lastName",
    email: "Custom_60",
    address: "address",
    city: "city",
    state: "state",
    zip: "zip",
    reservationId: "Custom_56",
    destination: "Custom_7",
    desiredDestination1: "Custom_36",
    desiredDestination2: "Custom_37",
    desiredDate1: "Custom_38",
    desiredDate2: "Custom_39",
    leadDate: "Custom_3",
    resortName: "Custom_47",
    spouseAge: "Custom_42",
    maritalStatus: "Custom_34",
    income: "Custom_31",
    notes: "Custom_52",
    numAdults: "Custom_49",
    numChildren: "Custom_50",
    guestAge: "Custom_41",
    dateOfBooking: "Custom_3",
    office: "Custom_6",
    urlLinkToRecord: "Custom_5",
    totalPrice: "Custom_2",
  },
  [DialerDomain.ODR]: {
    phone: "phone",
    firstName: "firstName",
    lastName: "lastName",
    email: "Custom_60",
    address: "address",
    city: "city",
    state: "state",
    zip: "zip",
    reservationId: "Custom_56",
    destination: "Custom_7",
    desiredDestination1: "Custom_36",
    desiredDestination2: "Custom_37",
    desiredDate1: "Custom_38",
    desiredDate2: "Custom_39",
    leadDate: "Custom_3",
    resortName: "Custom_47",
    spouseAge: "Custom_42",
    maritalStatus: "Custom_34",
    income: "Custom_31",
    notes: "Custom_52",
    numAdults: "Custom_49",
    numChildren: "Custom_50",
    guestAge: "Custom_41",
    dateOfBooking: "Custom_3",
    office: "Custom_6",
    urlLinkToRecord: "Custom_5",
    totalPrice: "Custom_2",
  },
  // ODS + DS: minimal mapping (legacy was the same).
  [DialerDomain.ODS]: {
    phone: "phone",
    firstName: "firstName",
    lastName: "lastName",
  } as FieldMap,
  [DialerDomain.DS]: {
    phone: "phone",
    firstName: "firstName",
    lastName: "lastName",
  } as FieldMap,
};

const ALIAS_MAP: Record<string, keyof StandardLead> = {
  primaryPhone: "phone",
  phone: "phone",
  resID: "reservationId",
  ResID: "reservationId",
  reservationId: "reservationId",
  Custom_56: "reservationId",
  Custom_10: "reservationId",
  LeadDate: "leadDate",
  leadDate: "leadDate",
  lead_date: "leadDate",
  office: "office",
  destination: "destination",
  urlLinkToRecord: "urlLinkToRecord",
  totalPrice: "totalPrice",
  desiredDestination1: "desiredDestination1",
  desiredDestination2: "desiredDestination2",
  desiredDate1: "desiredDate1",
  desiredDate2: "desiredDate2",
  Custom_3: "leadDate",
  Custom_6: "office",
  Custom_7: "destination",
  Custom_5: "urlLinkToRecord",
  Custom_2: "totalPrice",
  Custom_16: "desiredDestination1",
  Custom_17: "desiredDestination2",
  Custom_19: "desiredDate1",
  Custom_20: "desiredDate2",
};

function cleanPhone(p: unknown): string {
  return p == null ? "" : String(p).replace(/\D/g, "");
}

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export function normalize(
  domain: DialerDomain,
  rawData: Record<string, unknown>,
): StandardLead {
  const map = MAPS[domain];
  const lead = {} as Record<string, unknown>;

  if (map) {
    for (const [standardField, rawField] of Object.entries(map)) {
      const value = rawData?.[rawField] ?? rawData?.[`lead[0][${rawField}]`];
      if (!nonEmpty(value)) continue;
      if (standardField === "reservationId") lead[standardField] = String(value);
      else if (standardField === "phone") lead[standardField] = cleanPhone(value);
      else lead[standardField] = value;
    }
  }

  for (const [alias, standardField] of Object.entries(ALIAS_MAP)) {
    const value = rawData?.[alias];
    if (!nonEmpty(value)) continue;
    if (standardField === "reservationId") lead[standardField] = String(value);
    else if (standardField === "phone") lead[standardField] = cleanPhone(value);
    else lead[standardField] = value;
  }

  if (!lead.phone) {
    lead.phone = cleanPhone(rawData?.phone ?? rawData?.primaryPhone);
  }

  if (!lead.reservationId) {
    const fallbackId = rawData?.resID ??
      rawData?.Custom_41 ??
      rawData?.Custom_10 ??
      rawData?.Custom_56 ??
      rawData?.Custom_1;
    if (fallbackId) lead.reservationId = String(fallbackId);
  }

  return lead as unknown as StandardLead;
}

export function denormalize(
  domain: DialerDomain,
  lead: StandardLead,
): Record<string, unknown> {
  const map = MAPS[domain];
  if (!map) return lead as unknown as Record<string, unknown>;

  const output: Record<string, unknown> = {};
  for (const [standardField, rawField] of Object.entries(map)) {
    const val = (lead as unknown as Record<string, unknown>)[standardField];
    if (nonEmpty(val)) output[rawField] = val;
  }
  return output;
}
