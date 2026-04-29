import { Injectable, Logger } from "#nestjs/common";
import { reservations } from "@core/magic-mirror";

export interface GuestCrmData {
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

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  async findGuestByResId(resid: number): Promise<GuestCrmData | null> {
    try {
      this.logger.log(`[CRM] Looking up ResID: ${resid}`);
      const query = reservations.query("ReservationId", "is", String(resid));
      const results = await query.run();

      // sortByDateModified returns an array-like result at runtime
      const sorted: any = results.sortByDateModified("desc");
      const matched = sorted[0];

      if (!matched) {
        this.logger.warn(`[CRM] No record found for ResID: ${resid}`);
        return null;
      }

      return {
        ReservationId: Number(matched.ReservationId),
        GuestFullName: String(matched.GuestFullName ?? ""),
        SpouseFullName: String(matched.SpouseFullName ?? ""),
        SpouseName: String(matched.SpouseName ?? ""),
        AskTcpaVerbiage: String(matched.AskTcpaVerbiage ?? ""),
        EmailAddress: String(matched.EmailAddress ?? ""),
        Dnc: matched.Dnc === true || matched.Dnc === "true" || matched.Dnc === 1,
        MostRecentPackageIdDateOfBooking: String(matched.MostRecentPackageIdDateOfBooking ?? ""),
        MostRecentPackageIdCreditCardType: String(matched.MostRecentPackageIdCreditCardType ?? ""),
        MostRecentPackageIdLast4OfCreditCardOnly: String(
          matched.MostRecentPackageIdLast4OfCreditCardOnly ?? "",
        ),
      };
    } catch (e: any) {
      this.logger.error(`[CRM] Lookup failed for ResID ${resid}: ${e.message}`);
      return null;
    }
  }
}
