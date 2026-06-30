// Immediate push alert to Canary on a TERMINAL injection failure — Canary texts
// Adam the moment an injection fails for good (after the sweep has exhausted its
// retries; transient blips that self-heal never reach here, so this is signal,
// not noise). Nightly "all failures" go the other way: Canary POSTs to
// /canary/errors for the previous day. This is the immediate, injection-only leg.
//
// Fail-safe: NEVER throws, NEVER blocks the sweep. No-ops (with a warning) if
// CANARY_INGEST_URL is unset, so it's safe to ship before Canary's receiver is
// live.
//
// Contract (bot → Canary), so the Canary side can be built to match:
//   POST {CANARY_INGEST_URL}
//   Authorization: Bearer {CANARY_INGEST_TOKEN || CANARY_SECRET}
//   Content-Type: application/json
//   {
//     "source": "sms-bot",
//     "kind":   "injection-failure",
//     "phone":  "6142967343",
//     "error":  "ODR injection failed: ...",
//     "attempts": 5,
//     "ts":     "2026-06-30T13:46:24.681Z"
//   }

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

  // Canary renders the `error` field as the SMS body, so the phone + attempt
  // count must live INSIDE it to be actionable ("which lead failed?"). phone and
  // attempts are also kept as structured fields for any future Canary use.
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
