export interface FeedbackEvidenceRow {
  _id?: { toString(): string } | string | null;
  user?: { toString(): string } | string | null;
  reactionId?: { toString(): string } | string | null;
  eventKind?: string | null;
  action?: string | null;
  snapshotId?: { toString(): string } | string | null;
  candidateId?: string | null;
  baseKey?: string | null;
  fullSignature?: string | null;
  items?: Array<{ toString(): string } | string | null | undefined>;
  createdAt?: { toISOString(): string } | string | number | null;
  feedbackReason?: unknown;
  perItemFeedback?: unknown;
}
export const FEEDBACK_ACCOUNT_ROW_LIMIT: 2000;
export const REASON_AMENDMENT: "reason_amendment";
export const voteEvidenceFilter: { eventKind: { $ne: "reason_amendment" } };
export function resolveFeedbackEvidence<T extends FeedbackEvidenceRow>(votes: T[], amendments: FeedbackEvidenceRow[]): T[];
