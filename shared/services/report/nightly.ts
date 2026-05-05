// Nightly report builder + sender. Extracted from
// routes/api/report/nightly.ts so main.ts can invoke it directly from
// the Deno.cron handler without a self-HTTP-call.
//
// `date` is YYYY-MM-DD in ET. If provided, conversations are filtered to
// just that ET calendar day so the report reflects ONLY that day's
// activity. When called from the daily cron we pass yesterday's date so
// the email reflects the previous day's results, mailed early next morning.

import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { sendReport } from "@shared/services/postmark/client.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";
import { easternDateString } from "@shared/util/time.ts";

const LIST_LIMIT = 50_000;

export interface NightlyReportResult {
  date: string;
  counts: {
    texts: number;
    phones: number;
    sched: number;
    appts: number;
    activated: number;
    answered: number;
  };
}

function isOnDate(timestamp: string | undefined, etDate: string): boolean {
  if (!timestamp) return false;
  const t = new Date(timestamp);
  if (!Number.isFinite(t.getTime())) return false;
  return easternDateString(t) === etDate;
}

async function build(date: string) {
  const db = getFirestoreClient();

  const [convoAll, sched, activated, answered] = await Promise.all([
    db.list(conversationsCollection, { limit: LIST_LIMIT }),
    db.list(`${ROOT_COLLECTION}/scheduledinjections/byPhone`, { limit: LIST_LIMIT }),
    db.list(`${ROOT_COLLECTION}/guestactivated/byPhone`, { limit: LIST_LIMIT }),
    db.list(`${ROOT_COLLECTION}/guestanswered/byPhone`, { limit: LIST_LIMIT }),
  ]);

  // Conversations filtered to the requested ET day.
  const convo = convoAll
    .map((e) => e.data as unknown as ConversationMessage)
    .filter((m) => isOnDate(m.timestamp, date));

  const phones = new Set<string>();
  let appts = 0;
  for (const m of convo) {
    phones.add(m.phoneNumber);
    if ((m.nodeTag ?? "").toLowerCase().includes("appointment scheduled")) appts++;
  }

  // Activated/Answered for the report day specifically (filter on
  // activatedAt / answeredAt timestamps).
  const activatedToday = activated.filter((e) =>
    isOnDate((e.data as { activatedAt?: string }).activatedAt, date)
  );
  const answeredToday = answered.filter((e) =>
    isOnDate((e.data as { answeredAt?: string }).answeredAt, date)
  );

  const html = `<!doctype html><html><body style="font-family:sans-serif">
    <h2>SMS Bot — Daily Report</h2>
    <p>Date (ET): <b>${date}</b></p>
    <table cellpadding="6" border="1" style="border-collapse:collapse">
      <tr><th>Texts sent</th><td>${convo.length}</td></tr>
      <tr><th>Unique phones</th><td>${phones.size}</td></tr>
      <tr><th>Pending scheduled injections (snapshot)</th><td>${sched.length}</td></tr>
      <tr><th>Appointments tagged</th><td>${appts}</td></tr>
      <tr><th>Activated this day</th><td>${activatedToday.length}</td></tr>
      <tr><th>Answered this day</th><td>${answeredToday.length}</td></tr>
    </table>
  </body></html>`;

  const text = [
    `SMS Bot — Daily Report (${date} ET)`,
    `Texts sent: ${convo.length}`,
    `Unique phones: ${phones.size}`,
    `Pending scheduled injections (snapshot): ${sched.length}`,
    `Appointments tagged: ${appts}`,
    `Activated this day: ${activatedToday.length}`,
    `Answered this day: ${answeredToday.length}`,
  ].join("\n");

  const csvHeader = "phone,callId,timestamp,sender,message,nodeTag\n";
  const csvBody = convo.map((m) => {
    const fields = [
      m.phoneNumber,
      m.callId,
      m.timestamp,
      m.sender,
      m.message,
      m.nodeTag ?? "",
    ]
      .map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`)
      .join(",");
    return fields;
  }).join("\n");

  return {
    html,
    text,
    csv: csvHeader + csvBody,
    counts: {
      texts: convo.length,
      phones: phones.size,
      sched: sched.length,
      appts,
      activated: activatedToday.length,
      answered: answeredToday.length,
    },
  };
}

export async function runNightlyReport(
  date?: string,
): Promise<NightlyReportResult> {
  const reportDate = date ?? easternDateString();
  const r = await build(reportDate);

  await sendReport({
    subject: `[REPORT] SMS Bot — ${reportDate}`,
    htmlBody: r.html,
    textBody: r.text,
    attachments: [{
      Name: `conversations-${reportDate}.csv`,
      Content: btoa(unescape(encodeURIComponent(r.csv))),
      ContentType: "text/csv",
    }],
  });

  return { date: reportDate, counts: r.counts };
}

export function yesterdayEasternDateString(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return easternDateString(yesterday);
}
