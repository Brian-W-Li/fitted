/**
 * Reconcile the dashboard's RESTORED feedback chips against server latest-state (audit #2/#4).
 *
 * The dashboard persists each shown outfit's `feedback` mark to sessionStorage so a return visit shows
 * your reactions. But those marks go STALE the moment you curate the same outfit in History (flip or
 * remove): a stale "disliked" chip still renders the "Tell us why?" affordance, and answering it posts
 * a FRESH `rejected` whose newer `createdAt` silently supersedes the flip — reversing an explicit
 * curation choice in the one-shot corpus. It also hides the like/dislike buttons, so a removed
 * candidate can't be re-rated. Both close by deriving the chip from the server's current latest action
 * on restore, instead of trusting the cached mark.
 *
 * Pure so it is unit-tested without the dashboard's firebase/fetch/sessionStorage machinery.
 */

export type ServerAction = "accepted" | "rejected";

/** Map a server latest-state action to the client feedback chip (absent → unrated). */
export function feedbackFromAction(action: string | undefined): "liked" | "disliked" | undefined {
  if (action === "accepted") return "liked";
  if (action === "rejected") return "disliked";
  return undefined;
}

/** Bind key must match the server's {snapshotId, candidateId} card key. */
export function feedbackKey(o: { snapshotId: string; candidateId: string }): string {
  return `${o.snapshotId}:${o.candidateId}`;
}

/** One latest-state row from the GET /api/interactions history payload (the shape the dashboard reads). */
export interface HistoryActionRow {
  snapshotId?: string;
  candidateId?: string;
  action?: string;
}

/**
 * Build the `{snapshotId}:{candidateId} → action` map the reconcile reads, from the history GET payload.
 * Extracted (and tested) so a drift in the response field names or the key format reddens a unit test
 * rather than silently reopening the stale-chip → superseding-POST corpus vector (TEST-1). Rows missing
 * any of the three fields are skipped (an unbound/degenerate row can't key a card).
 */
export function buildActionByKey(rows: HistoryActionRow[] | undefined | null): Map<string, string> {
  const actionByKey = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.snapshotId && r.candidateId && r.action) {
      actionByKey.set(feedbackKey({ snapshotId: r.snapshotId, candidateId: r.candidateId }), r.action);
    }
  }
  return actionByKey;
}

/**
 * Rewrite each shown outfit's `feedback` from `actionByKey` (server latest-state per binding). Returns
 * the same array reference when nothing changed so the caller can skip a needless re-render / persist.
 */
export function reconcileShownFeedback<
  T extends { snapshotId: string; candidateId: string; feedback?: "liked" | "disliked" },
>(shown: T[], actionByKey: Map<string, string>): { shown: T[]; changed: boolean } {
  let changed = false;
  const next = shown.map((o) => {
    const fb = feedbackFromAction(actionByKey.get(feedbackKey(o)));
    if (fb === o.feedback) return o;
    changed = true;
    return { ...o, feedback: fb };
  });
  return changed ? { shown: next, changed } : { shown, changed };
}
