/** Browser-safe description of user-declared feedback; no inferred preferences or bans. */
export const FEEDBACK_SCOPES = ["item", "outfit", "request"] as const;
export const FEEDBACK_CONCERNS = ["fit", "formality", "style", "other"] as const;
export type FeedbackScope = typeof FEEDBACK_SCOPES[number];
export type FeedbackConcern = typeof FEEDBACK_CONCERNS[number];
export interface FeedbackReasonValue {
  codes?: string[];
  rawText?: string;
  scope?: FeedbackScope;
  itemId?: string;
  concern?: FeedbackConcern;
}
export interface PerItemFeedbackValue { itemId: string; disliked: boolean; notes?: string }

export type FeedbackReason = FeedbackReasonValue;
