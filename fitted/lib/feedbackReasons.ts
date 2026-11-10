import { FEEDBACK_REASON_CODES, FEEDBACK_REASON_RAW_TEXT_MAX_CHARS, type FeedbackReasonCode } from "@/models/OutfitInteraction";
import { FEEDBACK_SCOPES, FEEDBACK_CONCERNS, type FeedbackReasonValue } from "@/lib/feedbackTypes";
const REASON_CODE_SET = new Set<string>(FEEDBACK_REASON_CODES);
const NOTES_MAX_CHARS = FEEDBACK_REASON_RAW_TEXT_MAX_CHARS;
export class FeedbackReasonError extends Error {}

export function normalizeFeedbackReason(
  raw: unknown, memberIds?: Set<string>,
): (FeedbackReasonValue & { codes?: FeedbackReasonCode[] }) | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new FeedbackReasonError("feedbackReason must be an object");
  const r = raw as Record<string, unknown>;

  let scoped: Pick<FeedbackReasonValue, "scope" | "itemId" | "concern"> = {};
  if (r.scope != null) {
    if (!FEEDBACK_SCOPES.includes(r.scope as never) || !FEEDBACK_CONCERNS.includes(r.concern as never)) {
      throw new FeedbackReasonError("Choose a supported feedback scope and concern");
    }
    if (r.scope === "item") {
      if (typeof r.itemId !== "string" || !memberIds?.has(r.itemId)) {
        throw new FeedbackReasonError("The reason must refer to a piece in this outfit");
      }
    } else if (r.itemId != null) {
      throw new FeedbackReasonError("Only an item-scoped reason can name a garment");
    }
    if (r.concern === "fit" && r.scope !== "item") {
      throw new FeedbackReasonError("Personal fit feedback must identify the specific item");
    }
    scoped = { scope: r.scope as FeedbackReasonValue["scope"], concern: r.concern as FeedbackReasonValue["concern"],
      ...(r.scope === "item" ? { itemId: r.itemId as string } : {}) };
  } else if (r.itemId != null || r.concern != null) {
    throw new FeedbackReasonError("Reason target and concern require an explicit scope");
  }

  let codes: FeedbackReasonCode[] | undefined;
  if (r.codes != null) {
    if (!Array.isArray(r.codes)) throw new FeedbackReasonError("feedbackReason.codes must be an array");
    const seen = new Set<string>();
    for (const c of r.codes) {
      if (typeof c !== "string" || !REASON_CODE_SET.has(c)) {
        throw new FeedbackReasonError(`invalid feedbackReason code: ${JSON.stringify(c)}`);
      }
      seen.add(c);
    }
    if (seen.size > 0) codes = [...seen] as FeedbackReasonCode[];
  }

  let rawText: string | undefined;
  if (r.rawText != null) {
    if (typeof r.rawText !== "string") throw new FeedbackReasonError("feedbackReason.rawText must be a string");
    const trimmed = r.rawText.slice(0, NOTES_MAX_CHARS);
    if (trimmed.trim().length > 0) rawText = trimmed;
  }

  if (!codes && !rawText && !scoped.scope) return undefined; // nothing worth persisting
  return { ...scoped, ...(codes ? { codes } : {}), ...(rawText ? { rawText } : {}) };
}


/** Bound membership comes from the owned reaction, never a client garment echo. */
export function normalizePerItemFeedback(raw: unknown, memberIds: Set<string>) {
  if (raw == null) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) throw new FeedbackReasonError("Choose at most twenty per-item reasons");
  const seen = new Set<string>();
  const items = raw.map(entry => {
    if (!entry || typeof entry !== "object") throw new FeedbackReasonError("Invalid per-item reason");
    const { itemId, disliked, notes } = entry;
    if (typeof itemId !== "string" || !memberIds.has(itemId) || seen.has(itemId) || typeof disliked !== "boolean") {
      throw new FeedbackReasonError("Per-item reasons must identify unique reported pieces");
    }
    seen.add(itemId);
    return { itemId, disliked, ...(typeof notes === "string" ? { notes: notes.slice(0, NOTES_MAX_CHARS) } : {}) };
  });
  return items.length ? items : undefined;
}
