import { createHash } from "crypto";
import { Types, type ClientSession } from "mongoose";
import { isValidRequestId, OBJECT_ID_RE } from "@/lib/formats";
import { FEEDBACK_ACCOUNT_ROW_LIMIT, LEARNING_DISPOSITION, resolveLearningDispositions, voteEvidenceFilter, type FeedbackEvidenceRow } from "@/lib/feedbackEvidence.cjs";
import { ownerWriteFence } from "@/lib/ownerWriteFence";
import { snapshotVisible } from "@/lib/snapshotVisibility";
import type { InteractionDeps } from "@/lib/interactions";

export type LearningDisposition = "normal" | "exception" | "do_not_learn";
export class LearningMutationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new LearningMutationError(status, code, message); };
export interface LearningVote extends FeedbackEvidenceRow {
  styleContext?: { learningEnabled?: boolean; boardId?: string; profileId?: string; profileVersion?: number; routineId?: string | null; routineVersion?: number | null };
}
export function capturedLearningEnabled(vote: LearningVote): boolean {
  const context = vote.styleContext;
  return !!context && context.learningEnabled === true && !!context.boardId && OBJECT_ID_RE.test(context.boardId) &&
    !!context.profileId && OBJECT_ID_RE.test(context.profileId) && Number.isSafeInteger(context.profileVersion) && context.profileVersion! >= 1 &&
    !!context.routineId && OBJECT_ID_RE.test(context.routineId) && Number.isSafeInteger(context.routineVersion) && context.routineVersion! >= 1;
}
export function initialLearningDisposition(context: LearningVote["styleContext"], concern: unknown, perItem?: unknown): LearningDisposition {
  if (!capturedLearningEnabled({ styleContext: context })) return "do_not_learn";
  return concern != null || (Array.isArray(perItem) && perItem.length > 0) ? "exception" : "normal";
}
function learningId(user: Types.ObjectId, key: string): Types.ObjectId {
  return new Types.ObjectId(createHash("sha256").update(`learning-disposition.v1:${user}:${key}`).digest("hex").slice(0, 24));
}
export async function bumpStyleMemoryRevision(User: InteractionDeps["models"]["User"], user: Types.ObjectId, session: ClientSession): Promise<void> {
  await User.updateOne({ _id: user, erasureStarted: { $ne: true } }, { $inc: { styleMemoryRevision: 1 } }, { session });
}
export async function effectiveLearningState(target: LearningVote, deps: InteractionDeps, session?: ClientSession) {
  const amendments = await deps.models.OutfitInteraction.collection.find({ user: target.user, reactionId: target._id, eventKind: LEARNING_DISPOSITION }, { session }).toArray();
  const effective = resolveLearningDispositions([target], amendments)[0];
  return { learningDisposition: (effective.learningDisposition ?? initialLearningDisposition(target.styleContext, target.feedbackReason, target.perItemFeedback)) as LearningDisposition,
    dispositionRevision: effective.dispositionRevision ?? 0 };
}

/** A reason edit advances the eligibility revision atomically. Clearing never enrolls a prior exception. */
export async function appendReasonDisposition(user: Types.ObjectId, target: LearningVote, reasonId: Types.ObjectId,
  operationId: string, concern: unknown, perItem: unknown, deps: InteractionDeps, session: ClientSession, timestamp: Date): Promise<void> {
  if (!capturedLearningEnabled(target)) return;
  const previous = await effectiveLearningState(target, deps, session);
  const disposition = concern != null || (Array.isArray(perItem) && perItem.length > 0) ? "exception" : previous.learningDisposition;
  await deps.models.OutfitInteraction.create([{
    _id: learningId(user, `reason:${reasonId}`), user, eventKind: LEARNING_DISPOSITION, reactionId: target._id,
    operationId, requestKey: JSON.stringify({ reasonId: String(reasonId), learningDisposition: disposition }),
    snapshotId: target.snapshotId, candidateId: target.candidateId, baseKey: target.baseKey, fullSignature: target.fullSignature,
    items: target.items, styleContext: target.styleContext, learningDisposition: disposition, dispositionRevision: previous.dispositionRevision + 1,
    createdAt: timestamp, updatedAt: timestamp,
  }], { session, timestamps: false });
}

/** Explicit eligibility correction is append-only, expected-version-bound and never another reaction. */
export async function amendLearningDisposition(user: Types.ObjectId, raw: Record<string, unknown>, deps: InteractionDeps) {
  const fields = new Set(["kind", "reactionId", "operationId", "expectedDispositionRevision", "learningDisposition"]);
  if (Object.keys(raw).some(key => !fields.has(key)) || typeof raw.reactionId !== "string" || !OBJECT_ID_RE.test(raw.reactionId) ||
    typeof raw.operationId !== "string" || raw.operationId.length > 64 || !isValidRequestId(raw.operationId) ||
    !Number.isSafeInteger(raw.expectedDispositionRevision) || (raw.expectedDispositionRevision as number) < 0 ||
    !["normal", "exception", "do_not_learn"].includes(raw.learningDisposition as string)) fail(400, "contract_invalid", "Choose a current reaction and learning setting with a stable operation ID.");
  const reactionId = new Types.ObjectId(raw.reactionId as string);
  const operationId = (raw.operationId as string).toLowerCase();
  const id = learningId(user, operationId);
  const requestKey = JSON.stringify({ reactionId: String(reactionId), expectedDispositionRevision: raw.expectedDispositionRevision, learningDisposition: raw.learningDisposition });
  const { OutfitInteraction, GenerationSnapshot, User } = deps.models;
  const target = await OutfitInteraction.collection.findOne({ _id: reactionId, user, ...voteEvidenceFilter, action: { $in: ["accepted", "rejected"] } });
  if (!target) fail(404, "reaction_not_found", "This reaction is no longer available. Refresh your feedback.");
  if (!capturedLearningEnabled(target)) fail(409, "learning_not_enabled", "This reaction was not captured with experimental learning enabled for a saved direction and situation.");
  const timestamp = new Date();
  let dispositionRevision = 0;
  await deps.beforeWrite?.("amendment");
  await ownerWriteFence(User, user, async session => {
    const current = await OutfitInteraction.collection.findOne({ user, snapshotId: target.snapshotId, candidateId: target.candidateId,
      ...voteEvidenceFilter, action: { $in: ["accepted", "rejected"] } }, { session, sort: { createdAt: -1, _id: -1 } });
    if (!current) fail(404, "reaction_not_found", "This reaction was removed. Refresh your feedback.");
    if (String(current._id) !== String(reactionId)) fail(409, "reaction_changed", "This reaction changed. Refresh before changing learning.");
    const snapshot = await GenerationSnapshot.findOne({ _id: current.snapshotId, user, redacted: { $ne: true } }).session(session).lean();
    if (!snapshot || !await snapshotVisible(user, snapshot, { session })) fail(404, "snapshot_not_found", "This suggestion is no longer available.");
    const prior = await OutfitInteraction.collection.findOne({ _id: id }, { session });
    if (prior) {
      if (String(prior.user) !== String(user) || prior.eventKind !== LEARNING_DISPOSITION || prior.requestKey !== requestKey) fail(409, "operation_conflict", "This operation already has different learning content.");
      dispositionRevision = prior.dispositionRevision; return;
    }
    const effective = await effectiveLearningState(current, deps, session);
    if (effective.dispositionRevision !== raw.expectedDispositionRevision) fail(409, "disposition_changed", "Learning details changed. Refresh before editing them.");
    if (await OutfitInteraction.countDocuments({ user }).session(session) >= FEEDBACK_ACCOUNT_ROW_LIMIT) fail(400, "storage_limit", "Feedback storage limit reached.");
    dispositionRevision = effective.dispositionRevision + 1;
    await OutfitInteraction.create([{
      _id: id, user, eventKind: LEARNING_DISPOSITION, reactionId, operationId, requestKey,
      snapshotId: current.snapshotId, candidateId: current.candidateId, baseKey: current.baseKey, fullSignature: current.fullSignature,
      items: current.items, styleContext: current.styleContext,
      learningDisposition: raw.learningDisposition, dispositionRevision, createdAt: timestamp, updatedAt: timestamp,
    }], { session, timestamps: false });
    await bumpStyleMemoryRevision(User, user, session);
  });
  await deps.afterNativeWrite?.("amendment");
  if (!await User.exists({ _id: user, erasureStarted: { $ne: true } })) fail(401, "auth", "User not found.");
  const currentSnapshot = await GenerationSnapshot.findOne({ _id: target.snapshotId, user, redacted: { $ne: true } }).lean();
  if (!currentSnapshot || !await snapshotVisible(user, currentSnapshot)) fail(404, "snapshot_not_found", "This suggestion is no longer available.");
  return { id: String(id), reactionId: String(reactionId), dispositionRevision, learningDisposition: raw.learningDisposition };
}
