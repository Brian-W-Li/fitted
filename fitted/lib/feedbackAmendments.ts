import { createHash } from "crypto";
import { Types } from "mongoose";
import { isValidRequestId, OBJECT_ID_RE } from "@/lib/formats";
import { ownerWriteFence } from "@/lib/ownerWriteFence";
import { snapshotVisible } from "@/lib/snapshotVisibility";
import { normalizeFeedbackReason, normalizePerItemFeedback } from "@/lib/feedbackReasons";
import { voteEvidenceFilter, FEEDBACK_ACCOUNT_ROW_LIMIT } from "@/lib/feedbackEvidence.cjs";
import type { InteractionDeps } from "@/lib/interactions";

export class FeedbackMutationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new FeedbackMutationError(status, code, message); }

/** Deterministic immutable identity uses Mongo's existing unique _id index, including
 * across workers and lost acknowledgments. A collision fails closed via exact-key checks.
 * No new production index or inference about historical reason-rich votes is needed. */
function amendmentId(user: Types.ObjectId, operationId: string) {
  const digest = createHash("sha256").update(`feedback-reason.v1:${user}:${operationId}`).digest("hex");
  return new Types.ObjectId(digest.slice(0, 24));
}

/** An amendment is content about one vote, never another vote. The owner fence
 * serializes admission against corrections/removal and retries each read after conflict.
 * Preparation is stable; callback retries contain only database operations. */
export async function amendFeedback(user: Types.ObjectId, raw: Record<string, unknown>, deps: InteractionDeps) {
  const allowed = new Set(["kind", "reactionId", "operationId", "feedbackReason", "perItemFeedback"]);
  if (Object.keys(raw).some(key => !allowed.has(key)) || typeof raw.reactionId !== "string" || !OBJECT_ID_RE.test(raw.reactionId) ||
      typeof raw.operationId !== "string" || raw.operationId.length > 64 || !isValidRequestId(raw.operationId)) {
    fail(400, "contract_invalid", "Reasons require the original reaction and a stable operation ID");
  }
  const reactionId = new Types.ObjectId(raw.reactionId);
  const operationId = raw.operationId.includes("-") ? raw.operationId.toLowerCase() : raw.operationId;
  const id = amendmentId(user, operationId);
  const { OutfitInteraction, GenerationSnapshot, User } = deps.models;
  const target = await OutfitInteraction.collection.findOne({ _id: reactionId, user, ...voteEvidenceFilter, action: { $in: ["accepted", "rejected"] } });
  if (!target) fail(404, "reaction_not_found", "This reaction is no longer available. Refresh your feedback.");
  if (!target.snapshotId || !target.candidateId || !target.baseKey || !target.fullSignature) {
    fail(409, "reaction_changed", "This legacy reaction has no reliable suggestion binding");
  }
  const feedbackReason = normalizeFeedbackReason(raw.feedbackReason, new Set<string>(target.items.map(String)));
  const perItemFeedback = normalizePerItemFeedback(raw.perItemFeedback, new Set<string>(target.items.map(String)));
  if (target.action === "accepted" && (perItemFeedback || (feedbackReason && !feedbackReason.scope))) {
    fail(400, "contract_invalid", "Accepted outfits support scoped notes, not per-item dislike amendments");
  }
  // Canonical request identity: equivalent item/code order is still the same operation.
  const canonical = {
    reactionId: String(reactionId),
    feedbackReason: feedbackReason ? { ...feedbackReason, ...(feedbackReason.codes ? { codes: [...feedbackReason.codes].sort() } : {}) } : null,
    perItemFeedback: perItemFeedback ? [...perItemFeedback].sort((a, b) => a.itemId.localeCompare(b.itemId)) : null,
  };
  const requestKey = JSON.stringify(canonical);
  const snapshot = await GenerationSnapshot.findOne({ _id: target.snapshotId, user, redacted: { $ne: true } }).lean();
  if (!snapshot || !await snapshotVisible(user, snapshot)) fail(404, "snapshot_not_found", "This suggestion is no longer available");
  const timestamp = new Date();
  await deps.beforeWrite?.("amendment");
  await ownerWriteFence(User, user, async session => {
    const current = await OutfitInteraction.collection.findOne({
      user, snapshotId: target.snapshotId, candidateId: target.candidateId, ...voteEvidenceFilter,
      action: { $in: ["accepted", "rejected"] },
    }, { session, sort: { createdAt: -1, _id: -1 } });
    if (!current) fail(404, "reaction_not_found", "This reaction was removed. Refresh your feedback.");
    if (String(current._id) !== String(reactionId) || current.action !== target.action) {
      fail(409, "reaction_changed", "This reaction changed. Refresh before adding reasons.");
    }
    const previous = await OutfitInteraction.collection.findOne({ _id: id }, { session });
    if (previous) {
      if (String(previous.user) !== String(user) || previous.eventKind !== "reason_amendment" || previous.requestKey !== requestKey) {
        fail(409, "operation_conflict", "This reason operation already has different content");
      }
      return; // Confirmed retry; never admit another row or renew the vote.
    }
    const count = await OutfitInteraction.countDocuments({ user }).session(session);
    if (count >= FEEDBACK_ACCOUNT_ROW_LIMIT) fail(400, "storage_limit", "Feedback storage limit reached");
    await OutfitInteraction.create([{
      _id: id, user, eventKind: "reason_amendment", reactionId, operationId, requestKey,
      // Every binding/membership field is server-derived from the original vote.
      snapshotId: current.snapshotId, candidateId: current.candidateId,
      baseKey: current.baseKey, fullSignature: current.fullSignature, items: current.items,
      context: current.context, createdAt: timestamp, updatedAt: timestamp,
      ...(feedbackReason ? { feedbackReason } : {}), ...(perItemFeedback ? { perItemFeedback } : {}),
    }], { session, timestamps: false });
  });
  await deps.afterNativeWrite?.("amendment");
  // Same post-check contract as votes; transaction admission is the safety mechanism.
  if (!await User.exists({ _id: user, erasureStarted: { $ne: true } })) fail(401, "auth", "User not found");
  const currentSnapshot = await GenerationSnapshot.findOne({ _id: target.snapshotId, user, redacted: { $ne: true } }).lean();
  if (!currentSnapshot || !await snapshotVisible(user, currentSnapshot)) {
    await ownerWriteFence(User, user, session => OutfitInteraction.collection.deleteOne({ _id: id, user }, { session }));
    fail(404, "snapshot_not_found", "This suggestion is no longer available");
  }
  return { id: String(id), reactionId: String(reactionId) };
}
