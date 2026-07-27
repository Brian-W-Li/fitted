#!/usr/bin/env bash
#
# Stop hook: do not let a session end with commits that exist only on this machine.
#
# Receipt: on 2026-07-27 twelve commits sat unpushed while the checklist that was
# supposed to track that said otherwise. Nothing surfaced it; a person had to notice.
# This is the one guard in the design with a fully mechanical trigger AND a fully
# mechanical check, which is why it counts as an elimination rather than a reminder
# (docs/plans/maintainability.md S3.2).
#
# Exit codes matter here: a Stop hook exiting 1 prints but does NOT block. Exit 2 is
# the only blocking code.
#
set -uo pipefail

input=$(cat 2>/dev/null || true)

# Never fight a loop. Two independent guards, because `stop_hook_active` is not
# documented for Stop and must not be the only thing standing between a red state
# and an unbreakable loop:
#   1. honour stop_hook_active when the field is present;
#   2. a session-keyed marker, which caps this hook at ONE block per session no
#      matter what the input contains.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 || exit 0
unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
[ "${unpushed:-0}" -eq 0 ] && exit 0

session=$(printf '%s' "$input" | perl -0777 -ne 'print $1 if /"session_id"\s*:\s*"([^"]+)"/')
marker="${TMPDIR:-/tmp}/fitted-push-guard-${session:-nosession}"
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'fitted-push-guard-*' -mtime +7 -delete 2>/dev/null

[ -e "$marker" ] && exit 0
: > "$marker"

{
  printf '%s commit(s) on %s are not pushed:\n\n' \
    "$unpushed" "$(git rev-parse --abbrev-ref HEAD)"
  git log --oneline '@{u}..HEAD' | sed 's/^/  /'
  printf '\nPush them, or say why they should stay local. This will not ask again '
  printf 'in this session.\n'
} >&2
exit 2
