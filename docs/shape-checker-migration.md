# Migration Plan — adopt the rune `shape-checker` canonical shape

**Status:** PROPOSAL for review. No code has moved. **Owner:** Adam. **Goal:**
make `deno task shape-check` pass on this repo by restructuring the backend into
the rune canonical module shape, mirroring `autobottom`. We are **not** retiring
the checker.

---

## 0. TL;DR

Split the one Fresh app into two trees inside this repo, exactly like
`autobottom`:

- **`src/`** — canonical backend modules
  (`<module>/{entrypoints,domain/business,domain/data}/<feature>/mod.ts` +
  co-located tests, `mod-root.ts` barrels, `@module/` aliases). **This is the
  only tree `shape-checker` scans.**
- **`frontend/`** — the Fresh app (routes, islands, components, static, its own
  `deno.json`). **Untracked from git during the check** via the wrapper, so the
  checker never sees it.
- **root `main.ts`** — unified entrypoint that serves the Fresh app and
  registers the `Deno.cron` jobs, importing business logic from `src/` via
  `@module/` aliases.

`shape-checker` discovers its file set from **git tracking** (no include/exclude
flag). The wrapper `fixtures/scripts/shape-check.sh` temporarily untracks
everything that isn't `src/`, runs the check, and restores git on `trap EXIT`.

This is a **multi-session re-architecture of a live production app** (it texts
customers). It will be done **incrementally, one module per pass, green and
deployable at every step.** No big-bang.

---

## 1. The hard design fork (must resolve in the pilot)

In `autobottom` the backend is **Danet**, so HTTP entrypoints are real backend
controllers under `src/<module>/entrypoints/`, and the Fresh frontend is
**UI-only**, calling the API over HTTP. Our webhooks/API/cron are currently
**Fresh routes** + `Deno.cron` in `main.ts`. Two ways to reconcile:

### Model A — HTTP stays in Fresh (recommended first)

- `src/` modules contain **only** `domain/business` + `domain/data` (pure
  logic + external adapters). **No `entrypoints/`.**
- All HTTP (`/trigger`, `/sms-callback`, `/cal`, `/api/*`, UI pages) stays as
  **Fresh routes in `frontend/routes/`** (untracked). Each route handler becomes
  a **thin adapter** that calls a `src/` business function via a `@module/`
  alias.
- `Deno.cron` stays in root `main.ts`, calling `src/` business functions.
- **Least functional change → lowest risk to the live webhook/text path.**
- **OPEN RISK:** does `shape-checker`'s `structure` / `rune-entrypoint-presence`
  rule accept a module with no `entrypoints/`? **Unknown — this is the #1 thing
  the pilot resolves.** If it rejects entrypoint-less modules, fall back to B.

### Model B — full autobottom mirror (fallback)

- Webhooks/API/cron become `src/<module>/entrypoints/<feature>/mod.ts`, served
  by a backend router in `main.ts` (raw `Deno.serve` path-router, not Fresh).
- `frontend/` Fresh app is **UI dashboards only** (`/dashboard`, `/injections`,
  `/test`, `/login`), calling the API over HTTP.
- Matches autobottom exactly; modules get proper entrypoints.
- **Highest risk:** the webhook serving mechanism changes (today Fresh routes;
  then a hand-rolled router). Every external integration (ReadyMode, Bland,
  Cal.com) must keep hitting the same paths with identical behavior. Regression
  here = another texting outage.

**Decision:** start with **Model A**. The pilot (Phase 0) migrates one module
and runs `shape-check` to learn whether entrypoint-less modules pass. We only
adopt B if A is structurally impossible.

---

## 2. Target layout

```
sms-bot/                      (git root — backend repo, shape-checked)
├── deno.json                 workspace + @module/ aliases + tasks
├── main.ts                   unified entry: serve Fresh + register Deno.cron
├── fixtures/scripts/shape-check.sh   the git-untrack wrapper
├── src/
│   ├── core/                 shared kernel
│   │   ├── data/             firestore client + wrapper + paths
│   │   ├── business/         time, timing, env, util helpers
│   │   └── dto/              shared DTOs + validation (mod-root.ts)
│   ├── sms-flow/             trigger pipeline (ab-test, rate-limiter, dnc, orchestrator, sms-flow-context, sms-count)
│   ├── dialer/               readymode (tpi-client, portal-client, import-dispositions, scrape-orchestrator, service, auth, campaigns, config)
│   ├── messaging/            bland, conversations
│   ├── crm/                  quickbase, crm, sale-match
│   ├── scheduling/           injections, cal, cron-health
│   ├── reporting/            report, postmark, audit, canary
│   └── auth/                 firebase-auth session/verify
├── frontend/                 (own deno.json; UNTRACKED during shape-check)
│   ├── routes/               Fresh: UI + (Model A) webhooks/API adapters
│   ├── islands/ components/ static/ assets/
│   ├── ui/                   former shared/ui/pages.ts (dashboard HTML)
│   └── deno.json             Fresh imports + @module/ aliases → ../src
├── tests/                    (UNTRACKED during shape-check — until co-located)
├── scripts/                  ops scripts (UNTRACKED during shape-check)
└── docs/                     this file, context.md, etc. (UNTRACKED)
```

`src/` files that conform are the ONLY thing the checker sees. `bootstrap/`,
`assets/`, `fixtures/` also conform (per autobottom) and stay tracked.

---

## 3. Proposed module decomposition

| New `src/` location                                                          | From (current)                                                                                    | Layer                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| `core/data/firestore`                                                        | `shared/firestore/{client,wrapper,paths,legacy-key-map}.ts`                                       | data                   |
| `core/business/time`, `.../timing`, `.../env`                                | `shared/util/*`, env loader                                                                       | business               |
| `core/dto`                                                                   | `shared/types/*` (split per module where owned)                                                   | dto                    |
| `sms-flow/domain/business/{ab-test,rate-limiter,dnc,orchestrator,sms-count}` | `shared/services/{ab-test,rate-limiter,dnc,orchestrator,sms-count}`                               | business               |
| `sms-flow/domain/data/flow-context`                                          | `shared/services/sms-flow-context`                                                                | data                   |
| `dialer/domain/data/{tpi,portal}`                                            | `shared/services/readymode/{tpi-client,portal-client,auth}.ts`                                    | data                   |
| `dialer/domain/business/{import-dispositions,scrape,inject}`                 | `shared/services/readymode/{import-dispositions,scrape-orchestrator,service,campaigns,config}.ts` | business               |
| `messaging/domain/data/bland`, `.../business/conversations`                  | `shared/services/{bland,conversations}`                                                           | data/business          |
| `crm/domain/data/quickbase`, `.../business/sale-match` + `crm`               | `shared/services/{quickbase,crm,sale-match}`                                                      | data/business          |
| `scheduling/domain/business/{injections,cron-health}`, `.../data/cal`        | `shared/services/{injections,cron-health,cal}`                                                    | business/data          |
| `reporting/domain/business/{report,audit,canary}`, `.../data/postmark`       | `shared/services/{report,audit,canary,postmark}`                                                  | business/data          |
| `auth/domain/business/session`, `.../data/jwks`                              | `shared/services/auth`                                                                            | business/data          |
| `frontend/ui/pages.ts`                                                       | `shared/ui/pages.ts`                                                                              | **frontend, not src/** |

Split heuristic: **external-API/IO adapters → `domain/data`; pure logic →
`domain/business`.** Refine during migration.

---

## 4. The wrapper (`fixtures/scripts/shape-check.sh`)

Adapted from autobottom for OUR untrack set. Invariants preserved: **no
`set -e`**, **`trap cleanup EXIT`**, **`git add` without `-f`** in cleanup, and
the append-list and re-add-list **must stay in sync**.

```bash
#!/bin/bash
# Temporarily hide the Fresh tree + non-conforming roots from shape-checker.
# Shape-checker discovers files via git; we untrack, run, then restore on EXIT.
# NOTE: no set -e — shape-checker exits non-zero on violations and the trap
# MUST still restore git state.
GITIGNORE=".gitignore"
cleanup() {
  mv "$GITIGNORE.sc-bak" "$GITIGNORE" 2>/dev/null
  # No -f: respect the restored .gitignore (don't force-re-add _fresh/ etc.)
  git add frontend/ tests/ scripts/ docs/ main.ts vite.config.ts \
    deno.lock client.ts utils.ts 2>/dev/null
}
trap cleanup EXIT
cp "$GITIGNORE" "$GITIGNORE.sc-bak"
printf "frontend\ntests\nscripts\ndocs\nmain.ts\nvite.config.ts\nclient.ts\nutils.ts\n_fresh\n" >> "$GITIGNORE"
git rm -rf --cached --quiet frontend/ tests/ scripts/ docs/ 2>/dev/null
git rm -f  --cached --quiet main.ts vite.config.ts client.ts utils.ts 2>/dev/null
shape-checker "$@"
```

(The exact list is finalized once `frontend/` exists. Root `*.md`/`*.json` like
`README.md`, `context.md`, `firestore.indexes.json` also get appended — they
don't fit the `src/` spec, same category as `docs/`.)

**Gotcha (documented, not silently accepted):** the wrapper mutates `.gitignore`
and the git index live. The trap covers normal + violation exits, but a hard
kill mid-run leaves `frontend/` untracked + a `.gitignore.sc-bak` behind. Manual
recovery: `mv .gitignore.sc-bak .gitignore && git add -A`. Hardening option for
later: stash-based isolation instead of editing the index in place.

---

## 5. `deno.json` changes

- **`@module/` aliases:** `@core/ -> ./src/core/`,
  `@sms-flow/ -> ./src/sms-flow/`, `@dialer/`, `@messaging/`, `@crm/`,
  `@scheduling/`, `@reporting/`, `@auth/`. Keep existing `firebase-admin`, std,
  fresh imports.
- **Retire `@shared/` and `@/`** progressively as files move (keep both during
  migration so unmoved code still resolves).
- **Workspace:** make `frontend/` a workspace member (its own `deno.json` with
  Fresh imports + the `@module/` aliases pointing at `../src`).
- **Tasks** (mirror autobottom):
  - `check: deno check main.ts`
  - `check:tests: deno test --no-run -A --ignore=frontend/`
  - `test: deno test -A --ignore=frontend/`
  - `shape-check: bash fixtures/scripts/shape-check.sh`
  - `verify: deno task check && deno task check:tests && deno task shape-check && deno task test`
  - `build`/`dev`/`start` updated for `frontend/`.

---

## 6. Deploy migration (the risk Adam accepted)

Moving Fresh under `frontend/` **changes the Deno Deploy entrypoint + build
command.** Plan:

1. Land the restructure on a branch; never on `main` until proven.
2. Use a **Deno Deploy preview/branch deployment** to validate the new
   entrypoint serves every path identically (`/healthz`, `/trigger/readymode`,
   `/sms-callback/*`, `/cal/*`, `/dashboard`, `/canary/*`) before touching prod.
3. Confirm `Deno.cron` jobs still register from the new `main.ts` (cron scan is
   build-time on literal `Deno.cron(...)`).
4. Flip prod entrypoint only after the preview is green end-to-end.
5. Keep the env vars identical (esp. `RM_USER`/`RM_PASS` — see the 2026-06-18
   outage).

---

## 7. Phased rollout (incremental, green at every step)

- **Phase 0 — pilot (contained, reversible):**
  1. Create `src/` + `src/core` skeleton, `@module/` aliases, the wrapper, the
     tasks. Do NOT move Fresh yet.
  2. Migrate **one small module — `sms-count`** (few deps) into
     `src/reporting/domain/business/sms-count/{mod.ts,test.ts}`.
  3. Update its importers to `@reporting/...`.
  4. Run `deno task shape-check` → **learn whether Model A (no entrypoints/)
     passes.** Fix surfaced rule violations.
  5. `deno check`, full `deno test`, `deno task build` all green.
  6. **Checkpoint with Adam.** Decide A vs B from real checker output.
- **Phase 1 — establish `frontend/`:** move routes/islands/components/static/ui
  into `frontend/`, wire its `deno.json`, update `main.ts`, validate on a Deploy
  preview (Section 6). No `src/` business changes in this phase.
- **Phases 2–N — one module per pass:** `core` first (everything depends on it),
  then `messaging`, `crm`, `reporting`, `scheduling`, `auth`, `sms-flow`,
  `dialer` (most complex / highest-traffic last). Each pass: move → re-alias
  importers → co-locate tests → `shape-check` clean for that module → full
  suite + build green → commit.
- **Phase N+1 — finalize:** co-locate `tests/` into modules (so `tests/` can
  drop off the untrack list), update `context.md` §0.1 (shape-checker now
  ENFORCED, not ignored), remove `@shared/`/`@/`.

---

## 8. Invariants / definition of done

- `deno task shape-check` → `0 violations`.
- `deno task verify` green (check + tests + shape-check).
- Every external path responds identically on a Deploy preview before prod flip.
- `main` is always deployable; each module migration is its own reviewed commit.
- No behavior change to the texting pipeline — verified against logs
  post-deploy.

## 9. Open questions (resolve in Phase 0)

1. **Does an entrypoint-less module pass `structure` /
   `rune-entrypoint-presence`?** (Model A viability.) — pilot answers this.
2. Do the deeper rules (`layer-restrictions`, `module-isolation`,
   `dto-validation`, `signature-parity`) demand `sig.ts` contracts / DTO
   wrappers we don't have? — pilot surfaces the real list.
3. Does `core` as a shared kernel imported by every module violate
   `module-isolation`? (autobottom has `src/core`, so likely fine — confirm.)
4. Final untrack list for the wrapper once `frontend/` exists.

---

## 10. Honest cost/benefit

- **Cost:** multi-session migration of 66 `shared/` + 78 `routes/` files on a
  live system; a Deploy-entrypoint change; ongoing churn.
- **Benefit:** architectural consistency with autobottom, an enforced module
  spec, and a green shape-check.
- **Risk:** each phase can break a webhook/text path; mitigated by pilot-first,
  preview-deploy validation, and per-module commits.
