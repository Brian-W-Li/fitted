#!/usr/bin/env bash
# Run the repository hygiene ratchet.
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
cd "$ROOT/fitted" || exit 0

if out=$(npx --no-install jest --selectProjects hygiene 2>&1); then
  printf '%s\n' "$out"
  exit 0
else
  rc=$?
fi
printf 'Repo hygiene failed (exit %s). Full check output follows:\n\n%s\n' "$rc" "$out" >&2

if [ "$CLAUDE_HOOK" -eq 1 ]; then
  session=$(printf '%s' "$input" | perl -0777 -ne 'print $1 if /"session_id"\s*:\s*"([^"]+)"/')
  marker="${TMPDIR:-/tmp}/fitted-hygiene-guard-${session:-nosession}"
  find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'fitted-hygiene-guard-*' -mtime +7 -delete 2>/dev/null
  [ -e "$marker" ] && exit 0
  : > "$marker"
  exit 2
fi

exit 1
