// One-shot: dial a hardcoded list of phones via the production
// /sms-callback/bland/talk-now endpoint. Used today to drain the
// 4 most-recent stuck pending scheduledinjections after we discovered
// the sweep cron had been silently failing for ~16 days.
//
// Each call is sequential with a short pause between — we don't want
// to hammer Bland or RM with parallel injects, and a sequential trace
// makes it easy to see exactly what happened per phone in the log.
//
// The endpoint deletes the pending scheduledinjection as a side effect
// of the inject? No — talk-now writes a fresh injectionhistory entry
// with firedBy:"talk-now" but does NOT touch scheduledinjections. So
// after this script runs, follow up with a delete pass to clear the
// stale pending docs (see scripts/cleanup-stale-pendings.ts — TBD).
//
// Usage:
//   deno run -A --env-file=env/local scripts/talk-now-batch.ts

const ENDPOINT = Deno.env.get("APP_BASE_URL") ??
  "https://sms-bot.thetechgoose.deno.net";
const PHONES = [
  "2607600784",
  "4102006909",
  "7164674843",
  "9198846501",
];

console.log(`📞 talk-now batch: ${PHONES.length} phones → ${ENDPOINT}`);

for (const phone of PHONES) {
  console.log("");
  console.log(`→ ${phone}`);
  const t0 = performance.now();
  try {
    const res = await fetch(`${ENDPOINT}/sms-callback/bland/talk-now`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const elapsed = Math.round(performance.now() - t0);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON, leave as text
    }
    if (res.ok) {
      console.log(`  ✅ ${res.status} (${elapsed}ms)`);
    } else {
      console.log(`  ❌ ${res.status} (${elapsed}ms)`);
    }
    console.log(`  ${JSON.stringify(body, null, 2).split("\n").join("\n  ")}`);
  } catch (e) {
    console.log(`  ❌ fetch failed: ${(e as Error).message}`);
  }
  // Small breather between calls — 1 second is plenty.
  await new Promise((r) => setTimeout(r, 1000));
}

console.log("");
console.log("✅ done");
