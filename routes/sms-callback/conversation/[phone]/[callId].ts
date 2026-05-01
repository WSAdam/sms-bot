// Bland per-message conversation webhook receiver.
//
// Bland POSTs here on every USER/AGENT message in a live SMS conversation so
// we can mirror the transcript into Firestore in real time. Without this, the
// conversation history stops after storeInitialBlandMessage's one-shot fetch
// and the dashboard "People Replied" counter stays at 0.
//
// URL shape: /sms-callback/conversation/:phone/:callId
//   phone  — destination phone number; we accept any common shape and
//            normalize to the 10-digit Firestore key.
//   callId — Bland's conversation_id; passed straight through to storeMessage,
//            which writes the callId→phone lookup index FIRST (gotcha §15).
//
// Body: { sender, message, nodeTag? }
//   sender — Bland sends "USER" / "AGENT"; we also accept "Guest". We
//            collapse to the two-value union storeMessage expects.

import { define } from "@/utils.ts";
import { storeMessage } from "@shared/services/conversations/store.ts";
import { normalizePhone } from "@shared/util/phone.ts";

interface IncomingBody {
  sender?: string;
  message?: string;
  nodeTag?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const { phone: rawPhone, callId } = ctx.params as {
      phone: string;
      callId: string;
    };

    // Bland's pathway templating sometimes double-encodes the phone (e.g.
    // "+18432222986" arrives as "%252B18432222986"). Decode repeatedly until
    // stable so single-, double-, or unencoded inputs all normalize the same.
    let decodedPhone = rawPhone;
    for (let i = 0; i < 3 && decodedPhone.includes("%"); i++) {
      try {
        const next = decodeURIComponent(decodedPhone);
        if (next === decodedPhone) break;
        decodedPhone = next;
      } catch {
        break;
      }
    }

    const phone10 = normalizePhone(decodedPhone);
    if (!phone10) {
      return Response.json(
        { error: `Invalid phone parameter: ${rawPhone}` },
        { status: 400 },
      );
    }
    if (!callId) {
      return Response.json({ error: "Missing callId parameter" }, { status: 400 });
    }

    const body = await ctx.req.json().catch(() => null) as IncomingBody | null;
    if (!body) {
      return Response.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }
    if (typeof body.sender !== "string" || body.sender.length === 0) {
      return Response.json({ error: "Missing 'sender' in body" }, { status: 400 });
    }
    if (typeof body.message !== "string" || body.message.length === 0) {
      return Response.json({ error: "Missing 'message' in body" }, { status: 400 });
    }

    const senderUpper = body.sender.toUpperCase();
    const sender: "Guest" | "AI Bot" =
      senderUpper === "USER" || senderUpper === "GUEST" ? "Guest" : "AI Bot";

    const preview = body.message.length > 80
      ? body.message.slice(0, 80) + "…"
      : body.message;
    console.log(
      `[conv-webhook] phone=${phone10} callId=${callId} sender=${sender} ` +
        `(raw="${body.sender}") nodeTag=${body.nodeTag ?? "—"} msg="${preview}"`,
    );

    const stored = await storeMessage(
      phone10,
      callId,
      sender,
      body.message,
      body.nodeTag,
    );

    return Response.json({
      status: "success",
      phoneNumber: phone10,
      callId,
      timestamp: stored.timestamp,
    });
  },
});
