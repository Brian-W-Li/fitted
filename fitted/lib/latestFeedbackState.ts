/**
 * Per-candidate latest-STATE selection (§23-H61) — the ONE rule three runtimes must agree on.
 *
 * For each `{snapshotId, candidateId}` binding, the "current" feedback is the MOST-RECENT row:
 * max by `createdAt`, tie-broken by `_id` (hex desc). This is the same collapse the Python reducer
 * (`ml-system/fitted_core/reducers.py reduce_interaction_rows` — first-seen wins in a most-recent-first
 * scan) and the M6 export (`scripts/exportTrack2Core.cjs` — explicit createdAt-then-_id compare) apply.
 *
 * History (`getInteractions`) uses THIS helper so the curation view shows exactly one card per
 * candidate (a one-tap dislike + its later "why" enrich collapse to a single latest-state card; a
 * flip moves the candidate to the other tab). Cross-runtime agreement is pinned by ONE shared
 * fixture — `tests/fixtures/latestFeedbackState.fixture.json` — asserted equal here (jest), against
 * the export's picker (jest), and against the reducer (pytest). Do NOT trust DB sort as truth: apply
 * the explicit rule so a caller that forgot to sort still gets the correct winner.
 *
 * Reference: docs/plans/friend-facing-fixes.md PHASE 1 (D-2); docs/Fitted_Spec_v2.md §23-H61.
 */

/** A row must expose its binding + ordering fields; everything else is carried through opaquely. */
export interface LatestStateRow {
  snapshotId?: { toString(): string } | string | null;
  candidateId?: string | null;
  createdAt?: Date | string | number | null;
  _id?: { toString(): string } | string | null;
  action?: string | null;
}

// Only these actions win a candidate slot — parity with the Python reducer
// (`COUNTED_ACTIONS ∪ REJECTED_ACTION`) and the POST allowlist (`ALLOWED_ACTIONS`). A future
// `planned`/`packed` write must NOT let a newest such row supersede a standing like/dislike (it would
// win the collapse here but be skipped by the reducer — a cross-runtime split); gating here keeps the
// three homes identical. Move this set together with the reducer's if that ever changes.
const PARTICIPATING_ACTIONS = new Set(["accepted", "rejected"]);

function bindingKey(row: LatestStateRow): string | null {
  const snap = row.snapshotId == null ? "" : String(row.snapshotId);
  const cand = row.candidateId == null ? "" : String(row.candidateId);
  // `.trim()` for the bound check (parity with the reducer's `_truthy_str`, which strips) — a
  // whitespace-only id is unbound. The KEY keeps the original (untrimmed) values, as the reducer does.
  if (!snap.trim() || !cand.trim()) return null; // unbound (pre-M5 legacy) row — never participates
  return `${snap}::${cand}`;
}

function createdAtMs(row: LatestStateRow): number {
  // Mirror of exportTrack2Core.cjs: `new Date(createdAt ?? 0).getTime()`. A missing/invalid date
  // sorts oldest (0), never crashes the compare.
  const t = new Date((row.createdAt ?? 0) as string | number | Date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** True iff `a` is the more-recent row than `b` under the createdAt-then-_id rule. */
export function isNewer(a: LatestStateRow, b: LatestStateRow): boolean {
  const at = createdAtMs(a);
  const bt = createdAtMs(b);
  if (at !== bt) return at > bt;
  return String(a._id ?? "") > String(b._id ?? "");
}

/**
 * Collapse rows to the latest row per `{snapshotId, candidateId}`. Unbound rows are dropped.
 * Insertion order of first-seen keys is preserved so the caller can render/paginate deterministically
 * without re-sorting (the winner within each key is still the latest by the explicit rule).
 */
export function pickLatestPerCandidate<T extends LatestStateRow>(rows: Iterable<T>): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.action == null || !PARTICIPATING_ACTIONS.has(row.action)) continue; // only accepted/rejected win
    const key = bindingKey(row);
    if (key == null) continue;
    const prev = latest.get(key);
    if (!prev || isNewer(row, prev)) latest.set(key, row);
  }
  return [...latest.values()];
}
