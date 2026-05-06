// Appointment-tagged conversations (paged). Returns conversation messages
// whose nodeTag matches the appointment heuristic, optionally bounded by
// a date range.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  injectionHistoryCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const APPT_KEYWORDS = ["appointment scheduled"];
const LIST_LIMIT = 50_000;

function isAppointmentMatch(msg: ConversationMessage): boolean {
  const tag = (msg.nodeTag ?? "").toLowerCase();
  return APPT_KEYWORDS.some((kw) => tag.includes(kw));
}

// Parse "Appointment Scheduled: Apr 30, 3:00 PM" → ISO-ish display string.
// We don't try to be too clever — just extract whatever comes after the colon
// so the drill can show the booked appointment time as its own column.
function extractAppointmentText(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const m = msg.match(/appointment\s+scheduled\s*:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    const db = getFirestoreClient();
    // Pull conversations + injection history in parallel so each appointment
    // row can be enriched with the actual injection record (eventTime,
    // firedAt, status). Without this the drill said "No injection found"
    // for every row even when an injectionhistory doc exists.
    const [all, injections] = await Promise.all([
      db.list(conversationsCollection, { limit: LIST_LIMIT }),
      db.list(injectionHistoryCollection, { limit: LIST_LIMIT }),
    ]);

    // Build phone10 → latest injection record map. A phone may have multiple
    // history entries across rebookings; keep the most recent firedAt.
    interface InjRec {
      eventTime?: string;
      firedAt?: string;
      firedBy?: string;
      status?: string;
      scheduledAt?: string | number;
    }
    const injByPhone = new Map<string, InjRec>();
    for (const e of injections) {
      const sep = e.id.indexOf("__");
      const phone = sep >= 0 ? e.id.slice(0, sep) : e.id;
      if (!phone) continue;
      const rec = e.data as unknown as InjRec;
      const cur = injByPhone.get(phone);
      const curT = cur?.firedAt ?? "";
      const newT = rec.firedAt ?? "";
      if (!cur || newT > curT) injByPhone.set(phone, rec);
    }

    const allMatches = dedupeMessages(
      all
        .map((e) => e.data as unknown as ConversationMessage)
        .filter((m) => !isExcludedFromReporting(m.phoneNumber)),
    )
      .filter(isAppointmentMatch)
      .filter((m) => {
        const t = new Date(m.timestamp).getTime();
        if (!Number.isFinite(t)) return false;
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    // Enrich each match with: appointmentText (parsed from the "Appointment
    // Scheduled: ..." message), and injection record fields (scheduledFor,
    // firedAt, firedBy, injectionStatus) so the drill can show all of it
    // without a second round trip.
    const enriched = allMatches.map((m) => {
      const inj = m.phoneNumber ? injByPhone.get(m.phoneNumber) : undefined;
      return {
        ...m,
        appointmentText: extractAppointmentText(m.message),
        scheduledFor: inj?.eventTime ?? null,
        injectionFiredAt: inj?.firedAt ?? null,
        injectionFiredBy: inj?.firedBy ?? null,
        injectionStatus: inj?.status ?? null,
      };
    });

    const total = enriched.length;
    const items = enriched.slice((page - 1) * pageSize, page * pageSize);

    // Both `items`/`total` (frontend dashboard expects these) and
    // `matches`/`count` (legacy clients) are returned for compatibility.
    return Response.json({
      items,
      total,
      page,
      pageSize,
      matches: items,
      count: total,
    });
  },
});
