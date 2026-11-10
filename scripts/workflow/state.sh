#!/usr/bin/env bash
#
# Derived state for the Fitted repo. This is the shared implementation used by
# Codex skills and the optional Claude compatibility hooks.
#
# THE ONE RULE: every line printed here is COMPUTED at read time. Nothing is read
# from a file a human maintains. If a fact can only come from prose someone has to
# remember to update, it does not belong in this output -- that prose going stale is
# the exact failure this replaces (docs/plans/maintainability.md S1.3).
#
# Modes:
#   state.sh           full block -- position, register, suites, deploy (network)
#   state.sh --fast    position + register only; no suites, no network
#   state.sh --quiet   SessionStart mode: position only, and ONLY when something is off
#
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

MODE=full
case "${1:-}" in
  --fast)  MODE=fast ;;
  --quiet) MODE=quiet ;;
  "")      MODE=full ;;
  *)       echo "usage: state.sh [--fast|--quiet]" >&2; exit 64 ;;
esac

SPEC="docs/Fitted_Spec_v2.md"

# Portable timeout. macOS has no coreutils `timeout`; perl's alarm is always present.
# Deliberately does NOT redirect stderr: jest prints its "Tests:" summary there, and an
# internal 2>/dev/null discarded it at the source no matter what the caller asked for.
# Every call site merges with 2>&1 instead.
run_capped() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

# ---------------------------------------------------------------- position (git)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$branch" = "HEAD" ] && branch="detached@$(git rev-parse --short HEAD 2>/dev/null)"

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
  upstream_msg="${unpushed} unpushed"
else
  unpushed=0
  upstream_msg="NO UPSTREAM"
fi
dirty=$(git status --porcelain 2>/dev/null | grep -c . | tr -d ' ')

# --quiet exists to be silent. The receipt that justifies it firing is unpushed
# commits: 12 sat unpushed on 2026-07-27 while a checklist claimed otherwise. A
# dirty tree has no such receipt and is visible to a session anyway, so it is
# reported when the hook fires but never the reason it fires.
if [ "$MODE" = quiet ] && [ "$unpushed" -eq 0 ] && [ "$upstream_msg" != "NO UPSTREAM" ]; then
  exit 0
fi

printf 'FITTED · %s · %s · %s uncommitted\n' "$branch" "$upstream_msg" "$dirty"

# ---------------------------------------------------------- recent plans (git)
# This is only edit recency; it cannot establish which sprint is active. The active
# direction and sprint pointer live in the docs map and current sprint plan.
#
# TRAP: `git log -1 -- docs/plans/` (one call, newest commit touching the dir) names
# the WRONG plan. Verified 2026-07-27: it returned e4cdd1a2 "docs(H103): rank photo
# defects", a register commit that incidentally touched the runbook, while the plan
# actually being executed was maintainability.md. Recency must be computed PER FILE,
# and two are printed so a single incidental touch cannot masquerade as "the plan".
plan_rows=$(
  for f in docs/plans/*.md; do
    [ -e "$f" ] || continue
    meta=$(git log -1 --format='%ct|%h|%ar' -- "$f" 2>/dev/null)
    [ -n "$meta" ] && printf '%s|%s\n' "$meta" "$f"
  done | sort -t'|' -k1 -rn | head -2
)
if [ -n "$plan_rows" ]; then
  label=recent
  while IFS='|' read -r _ts sha ago path; do
    printf '%-6s %s · %s · %s\n' "$label" "$path" "$ago" "$sha"
    label=""
  done <<< "$plan_rows"
fi

[ "$MODE" = quiet ] && exit 0

# ------------------------------------- registers (spec S23 + docs/DEFECTS.md)
# Counted from the registers' own table rows, not from any written-down total.
# Statuses are the D6c closed vocabulary (S23: OPEN | BLOCKED: <cond> | RESOLVED;
# DEFECTS.md: OPEN | FIXED: <sha>), membership-enforced by hygiene check 8, so an
# exact-match count is reliable here.
#
# TRAP: naive `awk -F'|'` mis-parses rows whose text contains an inline-code pipe.
# Verified 2026-07-27: H101 embeds `top=...|outer=...`, which shifts its columns and
# reads its status as "outer=...". That silently undercounted OPEN by one (44 vs 45).
# Stripping `code spans` first makes every row split into exactly 6 fields.
reg_count() { # $1 file, $2 status regex (applied to the de-bolded, trimmed cell)
  grep -E '^\| H[0-9]+ \|' "$1" 2>/dev/null \
    | perl -pe 's/`[^`]*`/CODE/g' \
    | awk -F'|' -v re="$2" '{s=$4; gsub(/\*/,"",s); gsub(/^ +| +$/,"",s); if (s ~ re) n++} END{print n+0}'
}
DEFECTS="docs/DEFECTS.md"
if [ -f "$SPEC" ]; then
  h_open=$(reg_count "$SPEC" '^OPEN$')
  h_blocked=$(reg_count "$SPEC" '^BLOCKED: ')
  h_resolved=$(reg_count "$SPEC" '^RESOLVED$')
  if [ -f "$DEFECTS" ]; then
    d_open=$(reg_count "$DEFECTS" '^OPEN$')
    d_fixed=$(reg_count "$DEFECTS" '^FIXED: ')
    printf '%-6s S23 %s OPEN · %s BLOCKED · %s RESOLVED — defects %s OPEN · %s FIXED\n' \
      open "$h_open" "$h_blocked" "$h_resolved" "$d_open" "$d_fixed"
  else
    printf '%-6s S23 %s OPEN · %s BLOCKED · %s RESOLVED — %s missing\n' \
      open "$h_open" "$h_blocked" "$h_resolved" "$DEFECTS"
  fi
else
  printf '%-6s spec not found at %s\n' open "$SPEC"
fi

# Runtime selection is checkout-local by default, while explicit overrides let a
# caller use a managed interpreter without baking another checkout's path in.
select_python() { # $1 override variable value, then local candidate, then PATH name
  local override=$1 candidate=$2
  if [ -n "$override" ]; then
    if resolved=$(command -v "$override" 2>/dev/null); then printf '%s\n' "$resolved"; return 0; fi
    return 1
  fi
  if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; return 0; fi
  command -v python3 || return 1
}
print_failure_tail() { # $1 suite label, $2 captured combined output
  printf '  %s failure detail (last 30 lines):\n' "$1"
  printf '%s\n' "$2" | tail -30 | sed 's/^/    /'
}

# ------------------------------------------------------------------ suites (run)
if [ "$MODE" = full ]; then
  STATE_FAILED=0
  if jest_out=$( (cd fitted && run_capped 300 npx --no-install jest --selectProjects node jsdom 2>&1) ); then
    jest_rc=0
  else
    jest_rc=$?
  fi
  jest_line=$(printf '%s\n' "$jest_out" | grep -E '^Tests:' | tail -1)
  if [ -n "$jest_line" ]; then
    jest_pass=$(printf '%s\n' "$jest_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
    if [ "$jest_rc" -ne 0 ] || printf '%s\n' "$jest_line" | grep -q 'failed'; then
      jest="jest ${jest_pass} ✗ (exit ${jest_rc}; detail below)"
      STATE_FAILED=1
      print_failure_tail jest "$jest_out"
    else
      jest="jest ${jest_pass} ✓"
    fi
  elif [ "$jest_rc" -ne 0 ]; then
    jest="jest failed (exit ${jest_rc}; detail below)"
    STATE_FAILED=1
    print_failure_tail jest "$jest_out"
  else
    jest="jest unavailable (no parseable summary)"
    STATE_FAILED=1
    print_failure_tail jest "$jest_out"
  fi

  if py_exec=$(select_python "${FITTED_PYTHON:-}" "ml-system/.venv/bin/python"); then
    case "$py_exec" in /*) py_cmd=$py_exec ;; *) py_cmd="$ROOT/$py_exec" ;; esac
    if py_out=$( (cd ml-system && run_capped 300 "$py_cmd" -m pytest tests service/tests -q 2>&1) ); then
      py_rc=0
    else
      py_rc=$?
    fi
    py_line=$(printf '%s\n' "$py_out" | grep -E '[0-9]+ (passed|failed)' | tail -1)
    py_pass=$(printf '%s\n' "$py_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
    if [ "$py_rc" -ne 0 ] || printf '%s\n' "$py_line" | grep -q 'failed'; then
      py="pytest ${py_pass:-0} ✗ (exit ${py_rc}; detail below)"
      STATE_FAILED=1
      print_failure_tail pytest "$py_out"
    elif [ -n "$py_line" ]; then
      py="pytest ${py_pass:-?} ✓"
    else
      py="pytest unavailable (no parseable summary)"
      STATE_FAILED=1
      print_failure_tail pytest "$py_out"
    fi
  else
    py="pytest unavailable (set FITTED_PYTHON or install Python 3)"
    STATE_FAILED=1
  fi
  printf '%-6s %s · %s\n' tests "$jest" "$py"
fi

# ----------------------------------------------------------------- deploy (net)
if [ "$MODE" = full ]; then
  # Compare deployment creation time with commits touching fitted/. This is a
  # timestamp signal only; it does not verify which Git SHA was deployed.
  web="web unavailable"
  prod_url=$( (cd fitted && run_capped 30 npx --no-install vercel ls --prod 2>&1) \
              | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | head -1)
  if [ -n "$prod_url" ]; then
    created_ms=$( (cd fitted && run_capped 30 npx --no-install vercel inspect "$prod_url" --json 2>&1) \
                  | perl -0777 -ne 'print $1 if /"createdAt"\s*:\s*(\d+)/')
    if [ -n "${created_ms:-}" ]; then
      created_s=$(( created_ms / 1000 ))
      behind=$(git log --format='%ct' -- fitted/ | awk -v t="$created_s" '$1 > t' | grep -c .)
      when=$(date -r "$created_s" '+%Y-%m-%d %H:%M' 2>/dev/null)
      if [ "$behind" -eq 0 ]; then
        web="web timestamp current ✓ (deployed ${when}; timestamp comparison, not deployed-SHA verification)"
      else
        web="web timestamp behind by ${behind} commit(s) touching fitted/ (deployed ${when}; not deployed-SHA verification)"
      fi
    fi
  fi

  # fly: app name from fly.toml (config, not status); machine count from the API.
  fly="fly unavailable"
  if [ -f ml-system/fly.toml ]; then
    app=$(grep -m1 '^app' ml-system/fly.toml | sed -E 's/.*=[[:space:]]*"?([^"]+)"?.*/\1/')
    m_out=$(run_capped 30 fly machines list --app "$app" 2>&1)
    if [ -n "$m_out" ]; then
      n=$(printf '%s\n' "$m_out" | grep -cE '^[[:space:]]*[0-9a-f]{12,}[[:space:]]*│')
      started=$(printf '%s\n' "$m_out" | grep -cE '│[[:space:]]*started[[:space:]]*│')
      fly="fly ${n} machine(s), ${started} started"
      [ "$n" -ne 1 ] && fly="$fly  ⚠ PIN IS 1 MACHINE"
    fi
  fi
  printf '%-6s %s · %s\n' deploy "$web" "$fly"
fi

# --------------------------------------------------------------------- last (git)
printf '%-6s %s\n' last "$(git log -1 --format='%h %s' 2>/dev/null)"
exit "${STATE_FAILED:-0}"
