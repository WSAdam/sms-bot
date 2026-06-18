# TODO — Accurate "Injected Lead → Answered" Tracking

**Owner:** Adam · **Started:** 2026-06-18

## Goal

Every lead that opts in (talk-now / schedule-now / booking) and gets injected
into ODR, then later answers a dialer call, is counted as **answered** —
accurately, provable going forward, and corrected historically. The metric stays
gated: `answered ⊆ injected`.

**Core model:** opt-in pathway (Bland) → inject into ODR → dialer calls →
answered → (booked within X days = sale).

## HARD CONSTRAINTS (do not violate)

- 🛑 **ReadyMode API calls capped at ≤ 1 per minute.** No bursts. This rules out
  full-day call-log pulls (~79 requests/day) for backfill — use the per-lead
  lookup path instead. Every RM-touching script must throttle to 60s between
  calls.
- 🛑 **Nothing that touches the dialer runs without explicit per-step
  approval.** Read-only Firestore work is fine to run.
- 🛑 **Preserve manually-verified answers** (the ~34 date-only / noon-UTC
  `guestanswered` docs Adam pulled by hand) — merge, never overwrite with "no
  call found."
- 🛑 **No `git push` / deploy without explicit approval.**

## Grounded findings (2026-06-18, read-only)

- Injected universe recorded: **206** (`injectionhistory` +
  `scheduledinjections`).
- Opt-in pathway tags seen in `conversations`: `schedule time` (189),
  `appointment scheduled` (156 + 10 cap variant). **`talk-now` is NOT a visible
  conversation tag** — likely classified in Bland (TBD, Phase 1).
- Opt-in-tagged union: **336 phones**; **179 are opt-in-tagged but NOT recorded
  as injected** → real injection-recording gap to explain/fix.
- `guestanswered` stored: **153** (all within injected universe), but only **9**
  are verifiable against the ODR call logs we currently hold.
- ODR call logs on hand: **12 of ~73** distinct injection days (Feb 10 → Jun
  19).
- The `readymode-daily-pull` cron has been failing intermittently for a month
  (single-session lockout) — see [[project_readymode_answered_pull_outage]].

## Open questions (resolve early)

1. **Talk-now opt-ins** — where recorded? (Bland tag / Firestore field / dialer)
   → being investigated in Phase 1.
2. **Verification view** — dashboard panel (long-term) vs CLI report
   (immediate). Default: CLI report first for proof, dashboard panel after.

---

## Phase 0 — Deploy the forward data-collection fix _(Adam's push; no extra dialer load)_

- [ ] Deploy `fix/readymode-pull-reliability` (cron `logout_other_sessions`
      takeover + real-error capture + report ⚠ "unverified" flag). Committed
      `3662c77`, 145/145 tests.
- [ ] Confirm next 5:30 AM ET cron runs clean
      (`metrics/cronruns/readymode-daily-pull` lastStatus=ok, new day pulled).
- **Why first:** nothing downstream is trustworthy until the daily ODR pull
  stops dying.

## Phase 1 — Define & rebuild the TRUE injected universe _(Firestore + Bland; NO dialer)_

- [x] Find where **talk-now** opt-ins are recorded →
      `POST /sms-callback/bland/talk-now`
      (`routes/sms-callback/bland-talk-now.ts`): calls `injectLead()` then
      writes `injectionhistory` with `firedBy:"talk-now"`. So talk-now IS in
      injectionhistory.
- [x] Map opt-in pathways → injection: scheduled
      (sweep→`injectLead`→injectionhistory), talk-now (above), manual. All land
      in `injectionhistory`.
- [x] Reconcile: `orchestratorEvents` independently logs `action:"INJECT"` but
      only **53 ODR phones / 330 events** (partial/newer).
      `injectionhistory`=**206** is the fullest record (+4
      only-in-orchestrator). The **179 opt-in-tagged-not-injected** are mostly
      funnel **drop-offs** (hit `schedule time` node, never completed), NOT lost
      records. → recorded injected universe ≈ **206–210**, not thousands.
- [x] **FOUND THE RECORDING BUG:** both inject paths write `injectionhistory`
      **best-effort/non-fatal** (`catch→warn`) — bland-talk-now.ts:103-107 and
      the scheduled sweep. A failed write = lead injected into ODR but
      unrecorded → undercount.
- [ ] **DECISION NEEDED:** is ~206 the true injected count, or do you believe
      it's higher? Definitive check = compare our records vs ODR's
      actually-loaded leads (DIALER — needs approval, ≤1/min).
- [ ] Fix the non-fatal injection writes → make recording reliable going
      forward.
- [ ] Output: the real injected set + count.

## Phase 2 — Verify ANSWERED from real ODR call logs _(DIALER — approval per run, ≤1/min)_

- [x] Probed TPI per-lead lookup (lead 413466). **RULED OUT:** `get/lead`
      returns only `times called` + `status_time` — NO disposition/answered
      field. TPI tells us a lead was _dialed_, not _answered_. So the light
      per-lead method can't drive the answered backfill.
- [ ] **REVISED:** "answered" requires call-log dispositions = heavy full-day
      pulls (~79 req/day). Under ≤1/min, 61 missing days is impractical (days of
      runtime). DECISION: (a) forward-only (deploy + keep existing 153, preserve
      manual-verified), or (b) relax the cap for a bounded one-time call-log
      backfill.
- [ ] (if backfill) Merge with manually-verified answers (never overwrite).
- [ ] (if backfill) Rebuild `guestanswered` = injected ∩ answered. Firestore
      writes only.

## Phase 3 — Recompute + verify _(Firestore-only)_

- [ ] `backfill-daily-answered` → recompute `metrics/daily.answered` + lifetime.
- [ ] Checks: answered ≤ injected; spot-check known leads; reconcile vs Adam's
      manual list.

## Phase 4 — PROVE it works forward

- [ ] Build "Injected → Answered" view: per lead — opt-in pathway, injected
      date, call date, disposition, answered Y/N, booked Y/N. (CLI report
      first.)
- [ ] Watch 3–5 days post-deploy: new injected→answered leads appear, counts
      tick.
- [ ] Keep report ⚠-flag as the freeze alarm.

## Phase 5 — Hardening

- [ ] Lock the injection-recording fix with a test.
- [ ] Repair placeholder timestamps where real call times exist (keep
      manual-verified).
- [ ] Document the pathway→injected→answered definition in `context.md`.

---

_Started Phase 1 (Firestore-only) on 2026-06-18. Dialer steps (Phase 2) await
explicit approval and run at ≤1 RM call/min._
