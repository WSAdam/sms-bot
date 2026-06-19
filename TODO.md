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
- [x] **RESOLVED (then CORRECTED 2026-06-18):** the canonical "answered" source
      is the **Appointments** campaign call log, filtered by the call-log REPORT
      id **`81`** (NOT the inject channel code `cuCyA6Xoeu88` — the report
      silently ignores that and returns ALL ~24 campaigns). The earlier claim
      that this campaign "IS our entire ODR volume → thousands" was FALSE: it
      was an artifact of the ignored filter. Appointments is small (~1–2
      answered/week, ~74 distinct Feb→Jun). Answered = distinct phone, call ≥
      60s, disposition ≠ No-Answer/test.
- [ ] Fix the non-fatal injection writes → make recording reliable going forward
      (still worth it for the records, even though the call log is the truth).

## Phase 2 — Verify ANSWERED from real ODR call logs _(DIALER — approval per run, ≤1/min)_

- [x] Probed TPI per-lead lookup (lead 413466). **RULED OUT:** `get/lead`
      returns only `times called` + `status_time` — NO disposition/answered
      field. TPI tells us a lead was _dialed_, not _answered_. So the light
      per-lead method can't drive the answered backfill.
- [x] **Campaign filter — FIXED to report id `81`.**
      `scripts/backfill-answered-by-campaign.ts` now restricts to campaign 81 +
      the duration rule + writes real `answeredAt`.
- [x] ~~1-day dry-run (06/16): 1968 calls → 225 answered~~ **BOGUS** — that pull
      used `cuCyA6Xoeu88` (inject code), which the report ignores → it pulled
      ALL campaigns. The 225 docs were written, verified wrong vs the RM UI, and
      **rolled back**. With id 81 + duration gate, 06-16 = 0 new answers.
- [x] **Historical backfill DONE (corrected).** One read-only range pull of
      campaign 81 (Feb→Jun) found 74 distinct answered, 70 already present, **4
      NEW** — applied additively. `guestanswered` 153 → **157**.
- [x] **Recompute DONE:** `backfill-daily-answered.ts` → lifetime **157**, 46
      daily buckets, no duplicates (`skippedNoDate=0`).

## Phase 2b — Forward gate fix (so the LIVE cron stops undercounting) — DONE 2026-06-18

- [x] `scrapeReadymode` defaults to `restrictCampaign:"81"` → daily pull is ~1
      page, every row is our lead. `importDailyDispositions` now (a) requires
      duration ≥ 60s AND not No-Answer, (b) drops the injectionhistory funnel
      gate for campaign-restricted pulls (`requireInFunnel:false`);
      all-campaigns pulls keep it. `DialerCallRow.durationSecs` added (parsed
      from `Calltime`). 4 new unit tests; full suite 153/153. Trade-off:
      `calldispositions` now Appointments-scoped forward (dashboard activated
      drill-in).

## Phase 3 — Recompute + verify _(Firestore-only)_

- [x] `backfill-daily-answered` → recompute `metrics/daily.answered` + lifetime
      (done 2026-06-18; lifetime **157**).
- [ ] Checks: answered ≤ injected; spot-check known leads; reconcile vs Adam's
      manual list. (Open Q: only 70 of the 153 fall in the strict campaign-81 /
      ≥60s set — the other 83 are pre-Feb, other-campaign recycle answers, or
      manual; left as-is per "don't delete my data".)

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

---

# Shape-checker migration — `src/` canonical shape (all modules + kernel DONE; deploy-gated endgame remains, started 2026-06-19)

Migrate the backend into the rune canonical module shape so
`deno task
shape-check` passes. Full plan:
[docs/shape-checker-migration.md](docs/shape-checker-migration.md); architecture
summary: context.md §0.20.

**Invariants (enforced by the autocheck Stop hook):** scoped shape-check = 0,
`deno check main.ts` clean, tests green — at every step. App stays deployable
via `@shared/services/*` re-export shims. All commits local (not pushed).

**Per-module recipe:** `git mv` files →
`src/<module>/domain/{business,data}/<feature>/mod.ts` · rewrite intra-module
imports to `@module/` · write `export *` shim at old `shared/services/*` path ·
add co-located `test.ts` (business) / `smk.test.ts` (data) · `mod-root.ts`
(normal modules; not `core`) · `deno fmt` · verify · commit. Drop the migrated
path from `fixtures/scripts/shape-check.sh` `HIDE`.

## Done (green + committed)

- [x] Phase 0 pilot + wrapper + `@module/` aliases + `.gitignore` `/data/` fix.
- [x] **core** (timing, id, sms-count — business)
- [x] **sms-flow** (ab-test, rate-limiter, dnc · flow-context)
- [x] **crm** (qb-api/client/report/reservations · crm-lookup, sale-match,
      sale-match-cron)
- [x] **messaging** (bland, conv-store, conv-lookup · conv-dedupe, booking-scan,
      reseed)
- [x] **reporting** (postmark · nightly, audit, canary)
- [x] **scheduling** (cal, cron-marker, inj-schedule · inj-sweep, kv-breakdown)
- [x] **auth** (firebase · session, bearer, auth-config, middleware)
- [x] **config** → `core/business/{gates-config,cron-config}` (was
      shared/services/config).
- [x] **orchestrator** → `sms-flow` (`orchestrator-store` data ·
      `delayed-injection` business); 13 importers kept working via shims.
- [x] **dialer / readymode** (10 files) → new `src/dialer` module (3 data:
      rm-auth, portal-client, tpi-client · 7 business: campaigns, domain-config,
      mapping, validate-trigger, import-dispositions, scrape-orchestrator,
      lead-service). The LIVE `/trigger`→Bland path; verified hard (every live
      route + script + crm importer type-checks through the shims).
- [x] **Kernel → `core`**: firestore/\* → `core/data` (firestore-client/wrapper/
      paths/txn + legacy-key-map); `util/{time,phone}` → `core/business`;
      `types/*` → `core/dto` (flat); `config/{constants,env}` → `core/business`.
      All intra-core imports swept onto `@core`. `.gitignore` `env/` → `/env/`
      fix (sibling of the `data/` bug).

**Milestone:** all backend logic is now in canonical `src/` shape (8 modules +
full kernel). `shared/` holds only 66 re-export shims + `ui/pages.ts`. ~218
tests; scoped shape-check 0; `deno check main.ts` clean.

**MERGED + LIVE on prod (2026-06-19):** validated on a Deno Deploy branch
deployment of `shape-checker-migration` (all external paths identical to prod;
paranoia audit confirmed the rate-limit/throttle code is byte-identical to prod
and the ReadyMode guards fail closed), then **fast-forwarded into `main` and
pushed** (`origin/main` 546bed7 → 5abd52e, build `success`). `main.ts` was
byte-identical pre-merge, so the entrypoint + 8 `Deno.cron` registrations are
unchanged; post-deploy prod verification green. The refactor is
deploy-transparent (file moves behind shims). The entrypoint flip is the later
Fresh→`frontend/` finale below, NOT part of this.

## Remaining (the deploy-gated endgame — NOT done)

- [ ] **Relocate Fresh → `frontend/` + flip the Deno Deploy entrypoint** —
      requires a Deploy preview + push/deploy (hard constraint: no deploy w/o
      approval). Includes moving `shared/ui/pages.ts` (4963-line dashboard HTML)
      into `frontend/`.
- [ ] **Delete the 66 shims + rewrite ~157 `@shared` importers → `@core`/
      `@module`, then drop `shared` from `HIDE`.** Blocked: `shared/` can't be
      emptied until `ui/pages.ts` relocates (above). High-churn, lint-scope-only
      benefit; the shims are the intended bridge and work fine.
- [ ] **Co-locate `tests/` into src features → drop `tests/` from `HIDE`.**
      Fiddly (24 real tests must merge with the per-feature smoke tests);
      deferred with the rest of the finale.
