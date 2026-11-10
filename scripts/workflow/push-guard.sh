#!/usr/bin/env bash
# Report commits that are ahead of the configured upstream.
# Direct CLI calls are deterministic and never consume stdin. --claude-hook enables
# the optional Claude Stop-hook protocol and its per-session loop cap.
set -uo pipefail

CLAUDE_HOOK=0
if [ "${1:-}" = "--claude-hook" ]; then
  CLAUDE_HOOK=1
  shift
fi
if [ "$#" -gt 0 ]; then
  printf 'usage: %s [--claude-hook]\n' "$0" >&2
  exit 64
fi

input=
if [ "$CLAUDE_HOOK" -eq 1 ]; then
  input=$(cat 2>/dev/null || true)
  if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    exit 0
  fi
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 || exit 0
unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
[ "${unpushed:-0}" -eq 0 ] && exit 0

{
  printf '%s commit(s) on %s are not pushed:\n\n' \
    "$unpushed" "$(git rev-parse --abbrev-ref HEAD)"
  git log --oneline '@{u}..HEAD' | sed 's/^/  /'
} >&2

if [ "$CLAUDE_HOOK" -eq 1 ]; then
  session=$(printf '%s' "$input" | perl -0777 -ne 'print $1 if /"session_id"\s*:\s*"([^"]+)"/')
  marker="${TMPDIR:-/tmp}/fitted-push-guard-${session:-nosession}"
  find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'fitted-push-guard-*' -mtime +7 -delete 2>/dev/null
  [ -e "$marker" ] && exit 0
  : > "$marker"
  printf '\nPush them, or say why they should stay local. This will not ask again in this session.\n' >&2
  exit 2
fi

exit 1
