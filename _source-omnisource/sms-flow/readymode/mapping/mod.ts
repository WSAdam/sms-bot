import { Injectable, Logger } from "#nestjs/common";
import { DialerDomain } from "@sms-flow/readymode/dto/mod.ts";

export interface StandardLead {
  phone: string;

  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;

  reservationId?: string;

  destination?: string;
  desiredDestination1?: string;
  desiredDestination2?: string;
  desiredDate1?: string;
  desiredDate2?: string;

  leadDate?: string;
  dateOfBooking?: string;

  resortName?: string;
  spouseAge?: string;
  maritalStatus?: string;
  income?: string;

  notes?: string;
  numAdults?: string;
  numChildren?: string;
  guestAge?: string;

  office?: string;

  // Friendly URL params you’re sending from ACT
  urlLinkToRecord?: string;
  totalPrice?: string;
}

type FieldMap = Record<keyof StandardLead, string>;

@Injectable()
export class ReadymodeMappingService {
  private readonly logger = new Logger(ReadymodeMappingService.name);

  /**
   * NOTE:
   * - This is what we send to ReadyMode domains when INJECTING (denormalize).
   * - It’s also what we can parse if ReadyMode/ACT ever send back Custom_XX keys directly (normalize).
   */
  private readonly maps: Record<DialerDomain, FieldMap> = {
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

    [DialerDomain.ODS]: { phone: "phone", firstName: "firstName", lastName: "lastName" } as any,
    [DialerDomain.DS]: { phone: "phone", firstName: "firstName", lastName: "lastName" } as any,
  };

  /**
   * Friendly URL param aliases -> StandardLead fields.
   * This is the key fix for your ACT trigger URL format.
   */
  private readonly aliasMap: Record<string, keyof StandardLead> = {
    // Phone variants
    primaryPhone: "phone",
    phone: "phone",

    // Reservation variants
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

  normalize(domain: DialerDomain, rawData: any): StandardLead {
    const map = this.maps[domain];
    const lead: any = {};

    // 1) Map via FieldMap (Custom_XX -> StandardLead) when the inbound payload already uses those keys.
    if (map) {
      for (const [standardField, rawField] of Object.entries(map)) {
        const value = rawData?.[rawField] ?? rawData?.[`lead[0][${rawField}]`];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          if (standardField === "reservationId") {
            lead[standardField] = String(value);
          } else if (standardField === "phone") {
            lead[standardField] = this.cleanPhone(value);
          } else {
            lead[standardField] = value;
          }
        }
      }
    }

    // 2) Apply friendly aliases (THIS is what makes your URL format work).
    for (const [alias, standardField] of Object.entries(this.aliasMap)) {
      const value = rawData?.[alias];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        if (standardField === "reservationId") {
          lead[standardField] = String(value);
        } else if (standardField === "phone") {
          lead[standardField] = this.cleanPhone(value);
        } else {
          lead[standardField] = value;
        }
      }
    }

    // 3) Guaranteed phone fallback
    if (!lead.phone) {
      lead.phone = this.cleanPhone(rawData?.phone || rawData?.primaryPhone);
    }

    // 4) ReservationId fallback (keep your old behavior; it’s helpful)
    if (!lead.reservationId) {
      const fallbackId = rawData?.resID ||
        rawData?.Custom_41 ||
        rawData?.Custom_10 ||
        rawData?.Custom_56 ||
        rawData?.Custom_1;
      if (fallbackId) lead.reservationId = String(fallbackId);
    }

    return lead as StandardLead;
  }

  denormalize(domain: DialerDomain, lead: StandardLead): Record<string, any> {
    const map = this.maps[domain];
    if (!map) return lead as any;

    const output: any = {};
    for (const [standardField, rawField] of Object.entries(map)) {
      const val = (lead as any)[standardField];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        output[rawField] = val;
      }
    }

    return output;
  }

  private cleanPhone(phone: any): string {
    if (!phone) return "";
    return String(phone).replace(/\D/g, "");
  }
}
