#!/usr/bin/env bash
#
# Stop hook: do not let a session end having made hygiene WORSE than baseline
# (docs/plans/maintainability.md §5, D4). The suite it runs is the `hygiene` jest
# project — ratchets against fitted/tests/repoHygiene.baseline.json. A session may end
# with the campaign unfinished (current > target); it may not end with a regression
# (current > baseline). Unfinished work hands off as a register row, never as a red.
#
# Exit codes matter here: jest exits 1 on red, and a Stop hook exiting 1 prints but
# does NOT block. Exit 2 is the only blocking code — a naive `jest || true` (or bare
# jest) is a log line, not enforcement.
#
set -uo pipefail

input=$(cat 2>/dev/null || true)

# Never fight a loop — same two guards as push-guard.sh:
#   1. honour stop_hook_active when present;
#   2. a session-keyed marker capping this hook at ONE block per session, so a
#      genuinely-red check cannot wall the session in.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT/fitted" || exit 0

out=$(npx --no-install jest --selectProjects hygiene 2>&1) && exit 0

session=$(printf '%s' "$input" | perl -0777 -ne 'print $1 if /"session_id"\s*:\s*"([^"]+)"/')
marker="${TMPDIR:-/tmp}/fitted-hygiene-guard-${session:-nosession}"
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'fitted-hygiene-guard-*' -mtime +7 -delete 2>/dev/null

[ -e "$marker" ] && exit 0
: > "$marker"

{
  printf 'Repo hygiene is RED — a check regressed vs fitted/tests/repoHygiene.baseline.json\n'
  printf '(or the hygiene suite itself failed to run — read the output, not just this header):\n\n'
  printf '%s\n' "$out" | grep -E 'check 1?[0-9]+?[ :]|REGRESSION|✕' | head -30
  printf '\nFix the regression (or, if the change is deliberate, adjust the baseline in the same\n'
  printf 'commit and say so). This will not ask again in this session.\n'
} >&2
exit 2
