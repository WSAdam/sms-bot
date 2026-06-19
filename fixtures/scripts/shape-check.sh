#!/bin/bash
# Wrapper: make shape-checker scan ONLY the canonical src/ tree.
#
# shape-checker discovers its file set by walking the working tree (respecting
# .gitignore), NOT purely from `git ls-files`. During the Fresh→src/ migration,
# everything that isn't src/ still violates the canonical spec, so we temporarily
# add it to .gitignore (and untrack it), run the check, and restore git on exit.
#
# INVARIANTS (load-bearing — do not change without understanding why):
#   * NO `set -e`: shape-checker exits non-zero on violations and the trap MUST
#     still run to restore .gitignore + re-stage the hidden paths.
#   * `trap cleanup EXIT INT TERM HUP`: restores git state on normal exit,
#     violation exit, and Ctrl-C / kill / SSH hangup. cleanup is idempotent, so
#     running it on a signal and again on the follow-up EXIT is harmless.
#     (SIGKILL can't be trapped — see the manual recovery below.)
#   * `git add` WITHOUT -f in cleanup: respect the restored .gitignore so
#     deliberately-ignored build artifacts (_fresh/) aren't force-re-added.
#   * HIDE is used for BOTH untrack and restore — one array so they can't drift.
#
# Why HIDE is a hand-maintained list and NOT derived from `git ls-files`:
# shape-checker walks the filesystem, so it flags EMPTY on-disk dirs too (e.g.
# `islands/`, `components/` hold no tracked files yet are still scanned). A
# `git ls-files`-based derivation silently misses those and a naive filesystem
# walk trips over dot-dirs (`.claude/` is scanned-clean, `.githooks/` is not),
# so an auto-derived list reintroduces spurious violations. The list IS the
# source of truth. Drift is self-announcing: a new un-hidden top-level path
# turns shape-check red immediately (0 → N violations), so you can't miss it —
# just add the offending path here.
#
# As modules migrate from shared/ → src/, REMOVE their old paths from HIDE.
# When the migration is done, HIDE shrinks to just frontend/ + tests/ + docs/.
#
# Recovery if hard-killed (SIGKILL only — the trap handles every other signal):
#   mv .gitignore.sc-bak .gitignore && git add -A

GITIGNORE=".gitignore"

# Every top-level path that is NOT the canonical src/ tree.
# (deno.json, deno.lock, .gitignore, fixtures/, src/ stay tracked + scanned.)
HIDE=(
  .githooks
  .vscode
  README.md
  TODO.md
  _legacy-main.ts
  _source-omnisource
  assets
  client.ts
  components
  context.md
  docs
  firestore-safety.md
  islands
  firestore.indexes.json
  incident-2026-05-19.md
  main.ts
  routes
  scripts
  shared
  static
  tests
  utils.ts
  vite.config.ts
)

cleanup() {
  mv "$GITIGNORE.sc-bak" "$GITIGNORE" 2>/dev/null
  # No -f: respect the restored .gitignore.
  git add "${HIDE[@]}" 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

cp "$GITIGNORE" "$GITIGNORE.sc-bak"
printf '%s\n' "${HIDE[@]}" >> "$GITIGNORE"
for p in "${HIDE[@]}"; do
  git rm -r --cached --quiet "$p" 2>/dev/null
done

shape-checker "$@"
