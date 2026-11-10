import { Types } from "mongoose";
import User from "@/models/User";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { FEEDBACK_ACCOUNT_ROW_LIMIT, resolveFeedbackEvidence, type FeedbackEvidenceRow } from "@/lib/feedbackEvidence.cjs";
import { isNewer, pickLatestPerCandidate } from "@/lib/latestFeedbackState";
import { projectInteractionRow, projectSnapshotRow, type BehavioralRowsWire, type InteractionLean } from "@/lib/mlBehavioralRows";
import { visibleSnapshots, type SnapshotVisibility } from "@/lib/snapshotVisibility";
import { readStyleMemoryOwner } from "@/lib/styleMemory/store";
import { resolveOwnedStyleContext } from "@/lib/styleMemory/context";
import type { StyleContextSelection } from "@/lib/styleMemory/contract";
import { validCapturedStyleContext, type CapturedStyleContext } from "@/lib/styleContext";
import { initialLearningDisposition, type LearningDisposition } from "@/lib/styleLearningAmendments";

export interface PreferenceItem {
  id: string; role: "top" | "bottom" | "mid" | "outer" | "shoes";
  subtype: string | null; colors: string[]; pattern: string | null; fit: string | null;
}
export interface PreferenceObservation {
  id: string; snapshotId: string; candidateId: string; createdAt: string; action: "accepted" | "rejected";
  context: { ownerId: string; profileId: string; profileVersion: number; routineId: string | null; routineVersion: number | null; weather: CapturedStyleContext["weather"] };
  learningEnabled: boolean; learningDisposition: LearningDisposition; items: PreferenceItem[]; visible: true;
}
export interface PreferenceLedgerRow extends FeedbackEvidenceRow {
  createdAt?: Date | string | number | null;
  styleContext?: CapturedStyleContext;
  context?: { occasion?: string };
}
export interface PreferenceSnapshot extends SnapshotVisibility {
  _id: Types.ObjectId | string; user: Types.ObjectId | string;
  styleContext?: CapturedStyleContext;
  shownCandidateIds?: string[]; shownFullSignatures?: string[]; nSurfaced?: number;
  candidates?: { candidateId: string; template?: string; items?: { itemId: string; role: string }[] }[];
  itemSnapshots?: { itemId: string; engineVisible?: { subtype?: unknown; colorTags?: unknown; pattern?: unknown; fit?: unknown } }[];
}
const roles: Record<string, PreferenceItem["role"]> = { base_top: "top", base_bottom: "bottom", mid_layer: "mid", outer_layer: "outer", shoes: "shoes" };
const textOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const asIso = (value: unknown) => {
  const date = new Date((value ?? 0) as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Identity/weather are explicit partitions; opt-in changes eligibility, never invents a new context. */
export function matchesStylePartition(left: unknown, right: CapturedStyleContext): left is CapturedStyleContext {
  return validCapturedStyleContext(left) && left.boardId === right.boardId && left.profileId === right.profileId && left.profileVersion === right.profileVersion &&
    left.routineId === right.routineId && left.routineVersion === right.routineVersion && left.weather === right.weather;
}

/** Latest candidate and latest composition win before eligibility. An exception must hide its older normal vote. */
export function resolvePreferenceRows(ledger: PreferenceLedgerRow[], snapshots: PreferenceSnapshot[], ownerId: string, partition: CapturedStyleContext): PreferenceObservation[] {
  const sources = new Map(snapshots.filter(snapshot => String(snapshot.user) === ownerId && !snapshot.redacted && matchesStylePartition(snapshot.styleContext, partition))
    .map(snapshot => [String(snapshot._id), snapshot]));
  const latest = pickLatestPerCandidate(resolveFeedbackEvidence(ledger.filter(row => String(row.user) === ownerId), ledger));
  const compositions = new Map<string, { vote: PreferenceLedgerRow; observation: PreferenceObservation | null }>();
  for (const vote of latest) {
    const source = sources.get(String(vote.snapshotId));
    if (!source || !source.shownCandidateIds?.includes(String(vote.candidateId))) continue;
    const candidate = source.candidates?.find(row => row.candidateId === vote.candidateId);
    if (!candidate?.items?.length) continue;
    const composition = candidate.items.map(item => String(item.itemId)).sort().join("|");
    const previous = compositions.get(composition);
    if (previous && !isNewer(vote, previous.vote)) continue;
    // Preserve the newest composition as a suppressor even if its captured facts
    // cannot support learning. Missing facts must not resurrect an older vote.
    compositions.set(composition, { vote, observation: null });
    if (candidate.template !== "two_piece") continue;
    const facts = new Map((source.itemSnapshots ?? []).map(item => [String(item.itemId), item.engineVisible]));
    const items: PreferenceItem[] = [];
    for (const item of candidate.items) {
      const role = roles[item.role], fact = facts.get(String(item.itemId));
      if (!role || !fact) { items.length = 0; break; }
      items.push({ id: String(item.itemId), role, subtype: textOrNull(fact.subtype),
        colors: Array.isArray(fact.colorTags) ? fact.colorTags.filter((color): color is string => typeof color === "string") : [],
        pattern: textOrNull(fact.pattern), fit: textOrNull(fact.fit) });
    }
    if (!items.length || items.filter(item => item.role === "top").length !== 1 || items.filter(item => item.role === "bottom").length !== 1 ||
      new Set(items.map(item => item.id)).size !== items.length) continue;
    const captured = source.styleContext!;
    const createdAt = asIso(vote.createdAt);
    if (!createdAt) continue;
    const sameCapture = matchesStylePartition(vote.styleContext, partition) && vote.styleContext.learningEnabled === captured.learningEnabled;
    const observation: PreferenceObservation = {
      id: String(vote._id), snapshotId: String(vote.snapshotId), candidateId: String(vote.candidateId), createdAt,
      action: vote.action as PreferenceObservation["action"],
      context: { ownerId, profileId: captured.profileId, profileVersion: captured.profileVersion, routineId: captured.routineId, routineVersion: captured.routineVersion, weather: captured.weather },
      learningEnabled: sameCapture && captured.learningEnabled,
      learningDisposition: sameCapture ? (vote.learningDisposition as LearningDisposition | undefined) ?? initialLearningDisposition(captured, vote.feedbackReason, vote.perItemFeedback) : "do_not_learn",
      items, visible: true,
    };
    compositions.set(composition, { vote, observation });
  }
  return [...compositions.values()]
    .filter((row): row is { vote: PreferenceLedgerRow; observation: PreferenceObservation } => !!row.observation && row.observation.learningEnabled && row.observation.learningDisposition === "normal")
    .sort((a, b) => isNewer(a.vote, b.vote) ? -1 : isNewer(b.vote, a.vote) ? 1 : 0).slice(0, 200).map(row => row.observation);
}

export interface StylePreferenceEvidence {
  styleContext: CapturedStyleContext; behavioralRows: BehavioralRowsWire; interactionCountAtRequest: number;
  preferenceRows: PreferenceObservation[]; memoryRevision: number;
}

/** One snapshot read transaction captures owner revision, all admitted feedback, source visibility and frozen facts. */
export async function buildStylePreferenceEvidence(ownerId: string | Types.ObjectId, selection: StyleContextSelection,
  weatherScope: CapturedStyleContext["weather"], options: { allowHistoricalVersions?: boolean; afterOwnerRead?: () => Promise<void> } = {}): Promise<StylePreferenceEvidence> {
  if (!["cold", "mild", "hot", "unspecified"].includes(weatherScope)) throw new Error("Unsupported style weather scope");
  const owner = new Types.ObjectId(String(ownerId));
  const session = await User.db.startSession();
  try {
    return await session.withTransaction(async () => {
      const { data, revision } = await readStyleMemoryOwner(owner, session);
      await options.afterOwnerRead?.();
      const resolved = resolveOwnedStyleContext(data, revision, selection, { allowHistoricalVersions: options.allowHistoricalVersions });
      const styleContext: CapturedStyleContext = { ...resolved, weather: weatherScope };
      const ledger = await OutfitInteraction.collection.find({ user: owner }, { session, maxTimeMS: 5_000 }).sort({ createdAt: -1, _id: -1 }).limit(FEEDBACK_ACCOUNT_ROW_LIMIT + 1).toArray() as unknown as PreferenceLedgerRow[];
      if (ledger.length > FEEDBACK_ACCOUNT_ROW_LIMIT) throw new Error("Feedback exceeds the admitted owner ledger bound");
      const snapshotIds = [...new Set(ledger.map(row => String(row.snapshotId ?? "")).filter(value => /^[a-f0-9]{24}$/.test(value)))].map(value => new Types.ObjectId(value));
      const projection = { user: 1, styleContext: 1, variationSourceExperienceId: 1, variationSourceRevision: 1, redacted: 1,
        shownCandidateIds: 1, shownFullSignatures: 1, nSurfaced: 1, "candidates.candidateId": 1, "candidates.template": 1, "candidates.items": 1,
        "itemSnapshots.itemId": 1, "itemSnapshots.engineVisible.subtype": 1, "itemSnapshots.engineVisible.colorTags": 1,
        "itemSnapshots.engineVisible.pattern": 1, "itemSnapshots.engineVisible.fit": 1 };
      const sources = snapshotIds.length ? await GenerationSnapshot.collection.find({ user: owner, _id: { $in: snapshotIds } }, { session, projection, maxTimeMS: 5_000 }).toArray() as unknown as PreferenceSnapshot[] : [];
      const visibleSources = await visibleSnapshots(owner, sources, { session, styleMemory: data });
      const sourceById = new Map(visibleSources.map(source => [String(source._id), source]));
      const scopedVotes = resolveFeedbackEvidence(ledger, ledger).filter(vote => {
        const source = sourceById.get(String(vote.snapshotId));
        return source && matchesStylePartition(source.styleContext, styleContext) && ["accepted", "rejected"].includes(String(vote.action));
      }).sort((a, b) => isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0);
      const shown = await GenerationSnapshot.collection.find({ user: owner, nSurfaced: { $gt: 0 }, redacted: { $ne: true } },
        { session, maxTimeMS: 5_000, projection: { nSurfaced: 1, shownFullSignatures: 1, styleContext: 1, variationSourceExperienceId: 1, variationSourceRevision: 1 } })
        .sort({ createdAt: -1, _id: -1 }).limit(50).toArray() as unknown as Array<SnapshotVisibility & { nSurfaced?: number; shownFullSignatures?: string[] }>;
      const visibleShown = await visibleSnapshots(owner, shown, { session, styleMemory: data });
      return {
        styleContext, memoryRevision: revision, interactionCountAtRequest: scopedVotes.length,
        behavioralRows: { interactionRows: scopedVotes.slice(0, 500).map(row => projectInteractionRow(row as InteractionLean)), recentSnapshots: visibleShown.map(projectSnapshotRow) },
        preferenceRows: resolvePreferenceRows(ledger, visibleSources, String(owner), styleContext),
      };
    // Query-local maxTimeMS bounds finds without propagating a forbidden maxTimeMS
    // onto ordinary getMore commands through the driver's transaction CSOT setting.
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 5_000 });
  } finally { await session.endSession(); }
}
