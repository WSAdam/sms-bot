// Nightly stats email. Pulls dashboard counts, builds a small HTML body +
// CSV attachment of conversations, and sends via Postmark. Optional ?date=
// query selects the cutoff date (defaults to today in ET).

import { define } from "@/utils.ts";
import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { sendReport } from "@shared/services/postmark/client.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";
import { easternDateString } from "@shared/util/time.ts";

async function build(date: string) {
  const db = getFirestoreClient();

  const [convo, sched, activated, answered] = await Promise.all([
    db.list(conversationsCollection, { limit: 5000 }),
    db.list(`${ROOT_COLLECTION}/scheduledinjections/byPhone`, { limit: 5000 }),
    db.list(`${ROOT_COLLECTION}/guestactivated/byPhone`, { limit: 5000 }),
    db.list(`${ROOT_COLLECTION}/guestanswered/byPhone`, { limit: 5000 }),
  ]);

  const phones = new Set<string>();
  let appts = 0;
  for (const e of convo) {
    const m = e.data as unknown as ConversationMessage;
    phones.add(m.phoneNumber);
    if ((m.nodeTag ?? "").toLowerCase().includes("appointment scheduled")) appts++;
  }

  const html = `<!doctype html><html><body style="font-family:sans-serif">
    <h2>SMS Bot — Nightly Report</h2>
    <p>Date: <b>${date}</b></p>
    <table cellpadding="6" border="1" style="border-collapse:collapse">
      <tr><th>Texts sent (total)</th><td>${convo.length}</td></tr>
      <tr><th>Unique phones</th><td>${phones.size}</td></tr>
      <tr><th>Scheduled injections</th><td>${sched.length}</td></tr>
      <tr><th>Appointments tagged</th><td>${appts}</td></tr>
      <tr><th>Activated</th><td>${activated.length}</td></tr>
      <tr><th>Answered</th><td>${answered.length}</td></tr>
    </table>
  </body></html>`;

  const text = [
    `SMS Bot — Nightly Report (${date})`,
    `Texts sent (total): ${convo.length}`,
    `Unique phones: ${phones.size}`,
    `Scheduled injections: ${sched.length}`,
    `Appointments tagged: ${appts}`,
    `Activated: ${activated.length}`,
    `Answered: ${answered.length}`,
  ].join("\n");

  const csvHeader = "phone,callId,timestamp,sender,message,nodeTag\n";
  const csvBody = convo.map((e) => {
    const m = e.data as unknown as ConversationMessage;
    const fields = [m.phoneNumber, m.callId, m.timestamp, m.sender, m.message, m.nodeTag ?? ""]
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
      activated: activated.length,
      answered: answered.length,
    },
  };
}

async function handle(ctx: { req: Request }) {
  const url = new URL(ctx.req.url);
  const date = url.searchParams.get("date") ?? easternDateString();
  const r = await build(date);

  await sendReport({
    subject: `SMS Bot Report — ${date}`,
    htmlBody: r.html,
    textBody: r.text,
    attachments: [{
      Name: `conversations-${date}.csv`,
      Content: btoa(unescape(encodeURIComponent(r.csv))),
      ContentType: "text/csv",
    }],
  });

  return Response.json({ success: true, date, counts: r.counts });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
