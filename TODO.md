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

- 🛑 **ReadyMode pull rate: ≤ 1 DAY of call data per minute** (Adam's clarified
  cap — NOT 1 page/min). A day's pages run at normal speed (~50ms apart, like
  the live cron); space ≥60s between DAYS. (The per-lead TPI lookup was ruled
  out — `get/lead` returns only `times called`, no disposition.)
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

- [x] Deployed to `main` 2026-06-18 (`a7cd709`): cron `logout_other_sessions`
      takeover + real-error capture + report ⚠ "unverified" flag. Pushed → Deno
      Deploy auto-deploys. 145/145 tests.
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
- [x] **RESOLVED:** 206 is only the SMS-bot's _recorded_ injections. Adam loads
      most leads into ODR directly, all into the `ODR - Appointments` campaign —
      which IS our entire ODR call volume. So the true injected/loaded set is
      thousands, and the canonical source is the campaign-filtered call log, not
      `injectionhistory`. (Supersedes the "≈206-210, not thousands" line above.)
- [ ] Fix the non-fatal injection writes → make recording reliable going forward
      (still worth it for the records, even though the call log is the truth).

## Phase 2 — Verify ANSWERED from real ODR call logs _(DIALER — approval per run, ≤1/min)_

- [x] Probed TPI per-lead lookup (lead 413466). **RULED OUT:** `get/lead`
      returns only `times called` + `status_time` — NO disposition/answered
      field. TPI tells us a lead was _dialed_, not _answered_. So the light
      per-lead method can't drive the answered backfill.
- [x] **Pivot — campaign filter.** `ODR - Appointments` (`cuCyA6Xoeu88`) = ALL
      our leads, so a campaign-filtered call-log pull IS our answered set. Built
      `scripts/backfill-answered-by-campaign.ts` — paced ≤1 DAY of data/min (not
      per page; corrected after Adam clarified), weekdays only, additive, never
      overwrites manual-verified.
- [x] **1-day dry-run (06/16):** 1968 calls / 79 pages → **225 answered, all 225
      NEW** (vs 153 lifetime). Confirms the real count is in the thousands and
      the tool works. Timing: **3m21s for ONE day** (RM call_log ~2.5s/page). →
      full Feb→Jun (~90 weekdays) ≈ **~5 hours**. ≤1-day/min cap is satisfied
      for free (each day already takes ~3.4 min).
- [ ] **AWAITING GO:** run the full `--apply` (additive, ~5h, monitored; per-day
      progress logged) — or chunk it (month-by-month, ~1h each), or a recent
      window only.
- [ ] After backfill: `backfill-daily-answered.ts` to recompute counters.

## Phase 2b — Forward gate fix (so the LIVE cron stops undercounting)

- [ ] The live `import-dispositions.ts` still gates `guestanswered` to
      `injectionhistory` (~206), so forward it only counts answers from the
      SMS-bot's recorded injections — NOT all leads loaded into ODR. Widen the
      gate to the `ODR - Appointments` campaign (or drop it, since that campaign
      == our leads) so new days match the backfill's definition. Add a test.

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
- [x] Document the pathway→injected→answered definition in `context.md` (§0.19).

---

_Started Phase 1 (Firestore-only) on 2026-06-18. Dialer steps (Phase 2) await
explicit approval and run at ≤1 RM call/min._
