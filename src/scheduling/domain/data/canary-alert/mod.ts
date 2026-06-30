// Immediate push alert to Canary on a TERMINAL injection failure — Canary texts
// Adam the moment an injection fails for good (after the sweep exhausts its
// retries; transient blips that self-heal never reach here, so this is signal,
// not noise).
//
// NEVER throws — a failed alert must not break the sweep. It DOES block the
// caller up to INGEST_TIMEOUT_MS (5s) on the POST: the sweep awaits each push so
// the page actually delivers before the cron tears down, and terminal failures
// are rare enough that the per-terminal serialization is fine. No-ops (warns) if
// CANARY_INGEST_URL is unset.
//
// Contract (bot → Canary):
//   POST {CANARY_INGEST_URL}
//   Authorization: Bearer {CANARY_INGEST_TOKEN || CANARY_SECRET}
//   { "source":"sms-bot", "kind":"injection-failure",
//     "phone":"6142967343", "attempts":5, "ts":"<ISO>",
//     "error":"6142967343 — ODR injection failed: ... (gave up after 5 attempts)" }
//   Canary renders the `error` field as the SMS body, so it carries a composed
//   summary (phone + reason + attempt count) — which is why phone/attempts also
//   appear as structured fields.

const INGEST_TIMEOUT_MS = 5_000;

export interface InjectionFailureAlert {
  phone: string;
  error: string;
  attempts: number;
}

export async function pushInjectionFailure(
  alert: InjectionFailureAlert,
): Promise<void> {
  const url = Deno.env.get("CANARY_INGEST_URL");
  if (!url) {
    console.warn(
      `⚠️ [canary-alert] CANARY_INGEST_URL unset — injection failure for ` +
        `${alert.phone} NOT pushed (set it to enable immediate texts)`,
    );
    return;
  }
  const token = Deno.env.get("CANARY_INGEST_TOKEN") ??
    Deno.env.get("CANARY_SECRET") ?? "";

  // The composed `error` is the SMS body Canary renders (see the contract above).
  const summary =
    `${alert.phone} — ${alert.error} (gave up after ${alert.attempts} attempts)`;
  const body = JSON.stringify({
    source: "sms-bot",
    kind: "injection-failure",
    phone: alert.phone,
    attempts: alert.attempts,
    error: summary,
    ts: new Date().toISOString(),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });
    if (res.ok) {
      console.log(
        `📟 [canary-alert] pushed injection failure phone=${alert.phone}`,
      );
    } else {
      console.error(
        `❌ [canary-alert] push failed phone=${alert.phone}: HTTP ${res.status}`,
      );
    }
    // Drain the body so the connection can be reused / closed cleanly.
    await res.body?.cancel().catch(() => {});
  } catch (e) {
    // Alerting must never break the sweep — swallow and log.
    console.error(
      `❌ [canary-alert] push threw phone=${alert.phone} (non-fatal): ${
        (e as Error).message
      }`,
    );
  }
}
