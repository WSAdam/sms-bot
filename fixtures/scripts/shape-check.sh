#!/bin/bash
# Wrapper: make shape-checker scan ONLY the canonical src/ tree.
#
# shape-checker discovers its file set from git tracking (no include/exclude
# flag). During the Fresh→src/ migration, everything that isn't src/ still
# violates the canonical spec, so we temporarily untrack it, run the check, and
# restore git on EXIT.
#
# INVARIANTS (load-bearing — do not change without understanding why):
#   * NO `set -e`: shape-checker exits non-zero on violations and the trap MUST
#     still run to restore .gitignore + re-stage the hidden paths.
#   * `trap cleanup EXIT`: restores git state on normal exit, violation exit,
#     and most signals.
#   * `git add` WITHOUT -f in cleanup: respect the restored .gitignore so
#     deliberately-ignored build artifacts (_fresh/) aren't force-re-added.
#   * HIDE list is used for BOTH untrack and restore — keep them one list so
#     they can't drift.
#
# As modules migrate from shared/ → src/, REMOVE their old paths from HIDE.
# When the migration is done, HIDE shrinks to just frontend/ + tests/ + docs/.
#
# Recovery if hard-killed mid-run:
#   mv .gitignore.sc-bak .gitignore && git add -A

GITIGNORE=".gitignore"

# Every tracked top-level path that is NOT the canonical src/ tree.
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
trap cleanup EXIT

cp "$GITIGNORE" "$GITIGNORE.sc-bak"
printf '%s\n' "${HIDE[@]}" >> "$GITIGNORE"
for p in "${HIDE[@]}"; do
  git rm -r --cached --quiet "$p" 2>/dev/null
done

shape-checker "$@"
