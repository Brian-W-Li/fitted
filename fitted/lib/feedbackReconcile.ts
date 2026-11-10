/** Restore chips and amendment targets from fresh owner-scoped History evidence. */

import type { FeedbackReasonValue, PerItemFeedbackValue } from "@/lib/feedbackTypes";
import { OBJECT_ID_RE } from "@/lib/formats";

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
  id?: string;
  feedbackReason?: FeedbackReasonValue;
  perItemFeedback?: PerItemFeedbackValue[];
}
type CurrentReaction = Pick<HistoryActionRow, "feedbackReason" | "perItemFeedback" | "id"> & { action: string };

/**
 * Build the `{snapshotId}:{candidateId} → current reaction` map the reconcile reads, from the history GET payload.
 * Extracted (and tested) so a drift in the response field names or the key format reddens a unit test
 * rather than silently reopening the stale-chip → wrong amendment target (TEST-1). Rows missing
 * any of the three fields are skipped (an unbound/degenerate row can't key a card).
 */
export function buildActionByKey(rows: HistoryActionRow[] | undefined | null): Map<string, CurrentReaction> {
  const actionByKey = new Map<string, CurrentReaction>();
  for (const r of rows ?? []) {
    if (r.snapshotId && r.candidateId && r.action) {
      actionByKey.set(feedbackKey({ snapshotId: r.snapshotId, candidateId: r.candidateId }), { action: r.action, ...(r.feedbackReason ? { feedbackReason: r.feedbackReason } : {}), ...(r.perItemFeedback ? { perItemFeedback: r.perItemFeedback } : {}), ...(typeof r.id === "string" && OBJECT_ID_RE.test(r.id) ? { id: r.id.toLowerCase() } : {}) });
    }
  }
  return actionByKey;
}

/**
 * Rewrite each shown outfit's `feedback` from `actionByKey` (server latest-state per binding). Returns
 * the same array reference when nothing changed so the caller can skip a needless re-render / persist.
 */
export function reconcileShownFeedback<
  T extends { snapshotId: string; candidateId: string; feedback?: "liked" | "disliked"; reactionId?: string; feedbackReason?: FeedbackReasonValue; perItemFeedback?: PerItemFeedbackValue[] },
>(shown: T[], actionByKey: Map<string, CurrentReaction>): { shown: T[]; changed: boolean } {
  let changed = false;
  const next = shown.map((o) => {
    const row = actionByKey.get(feedbackKey(o));
    const fb = feedbackFromAction(row?.action);
    const reactionId = fb ? row?.id : undefined;
    const feedbackReason = fb ? row?.feedbackReason : undefined;
    const perItemFeedback = fb ? row?.perItemFeedback : undefined;
    if (fb === o.feedback && reactionId === o.reactionId && JSON.stringify(feedbackReason) === JSON.stringify(o.feedbackReason)
      && JSON.stringify(perItemFeedback) === JSON.stringify(o.perItemFeedback)) return o;
    changed = true;
    return { ...o, feedback: fb, reactionId, feedbackReason, perItemFeedback };
  });
  return changed ? { shown: next, changed } : { shown, changed };
}
