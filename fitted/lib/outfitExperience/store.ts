import { ownerWriteFence, OwnerWriteUnavailable } from "@/lib/ownerWriteFence";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection, ensureExperienceIndexes, type ExperienceRecord, type ExperienceRevision } from "@/models/OutfitExperience";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { createInput, editInput, retractInput, operationId, objectId, MAX_EXPERIENCE_REVISIONS, type WearInput, type WearState } from "./contract";
import { suggestedWearContext, userWearContext } from "./context";
import { ExperienceError } from "./errors";
import { requireSource } from "./source";
import { resolveComposition, type ResolvedComposition } from "./composition";

export const MAX_EXPERIENCES_PER_ACCOUNT = 1000;

type Mutation = "create" | "revise" | "retract" | "erase";
interface StoreOptions {
  now?: () => Date;
  /** Test-only scheduling seam; production supplies no hooks. */
  beforeWrite?: (mutation: Mutation) => Promise<void>;
  afterWrite?: (mutation: Mutation) => Promise<void>;
  /** Test-only ambiguous acknowledgement after a native write has committed. */
  afterNativeWrite?: (mutation: Mutation) => Promise<void>;
}
export interface ExperienceAcknowledgement {
  experienceId: string;
  lifecycle: ExperienceRecord["lifecycle"];
  acknowledgedRevision: number;
  currentRevision: number;
}
function duplicate(error: unknown): boolean { return (error as { code?: number })?.code === 11000; }
// Shared by store objects within a worker. This is courtesy pacing, not a distributed quota;
// a public write route must add an account storage budget before broader exposure.
const missingMarkerBuckets = new Map<string, { minute: number; count: number }>();

/** Sole application writer. Native CAS/replacement avoids Mongoose defaults restoring erased content. */
export class ExperienceStore {
  constructor(private readonly options: StoreOptions = {}) {}
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private async owner(id: string): Promise<Types.ObjectId> {
    const user = new Types.ObjectId(objectId(id));
    await ensureExperienceIndexes();
    if (!await User.exists({ _id: user, erasureStarted: { $ne: true } })) throw new ExperienceError(410, "account_unavailable");
    return user;
  }
  private async admit(user: Types.ObjectId, id: string): Promise<void> {
    // One atomic owner-document operation, shared across workers. Reservations are never
    // released: a failed write can retry with its ID, and erased IDs cannot regain capacity.
    const result = await User.collection.updateOne({ _id: user, $or: [
      { experienceAdmissions: id },
      { $expr: { $lt: [{ $size: { $ifNull: ["$experienceAdmissions", []] } }, MAX_EXPERIENCES_PER_ACCOUNT] } },
    ] }, { $addToSet: { experienceAdmissions: id } });
    if (!result.matchedCount) {
      if (!await User.exists({ _id: user, erasureStarted: { $ne: true } })) throw new ExperienceError(410, "account_unavailable");
      throw new ExperienceError(429, "storage_limit");
    }
  }
  private find(user: Types.ObjectId, id: string) {
    return experienceCollection().findOne({ user, experienceId: id });
  }
  private async redactDerived(user: Types.ObjectId, id: string, keepRevision?: number): Promise<void> {
    await GenerationSnapshot.collection.updateMany({ user, variationSourceExperienceId: id,
      ...(keepRevision === undefined ? {} : { variationSourceRevision: { $lt: keepRevision } }),
      redacted: { $ne: true } }, { $set: { redacted: true, redactedAt: this.now(),
      redactionReason: "experience_changed" } });
  }
  private async afterWrite(user: Types.ObjectId, mutation: Mutation): Promise<void> {
    await this.options.afterWrite?.(mutation);
    if (!await User.exists({ _id: user, erasureStarted: { $ne: true } })) {
      // Covers writes which landed after the account route's final sweep.
      await experienceCollection().deleteMany({ user });
      throw new ExperienceError(410, "account_unavailable");
    }
  }
  private async ownedWrite<T>(user: Types.ObjectId, mutation: Mutation, write: () => Promise<T>): Promise<T> {
    let writeError: unknown;
    let value: T | undefined;
    try { value = await write(); await this.options.afterNativeWrite?.(mutation); }
    catch (error) { writeError = error instanceof OwnerWriteUnavailable ? new ExperienceError(410, "account_unavailable") : error; }
    try { await this.afterWrite(user, mutation); }
    catch (guardError) { if (!writeError) throw guardError; }
    if (writeError) throw writeError;
    return value as T;
  }
  private acknowledgement(record: ExperienceRecord, revision: number): ExperienceAcknowledgement {
    if (record.lifecycle === "erased") throw new ExperienceError(410, "experience_erased");
    return { experienceId: record.experienceId, lifecycle: record.lifecycle, acknowledgedRevision: revision, currentRevision: record.currentRevision! };
  }
  private replay(record: ExperienceRecord | null, token: string, key: string): ExperienceAcknowledgement | null {
    if (!record) return null;
    if (record.lifecycle === "erased") throw new ExperienceError(410, "experience_erased");
    const saved = record.revisions!.find(r => r.operationId === token);
    if (!saved) return null;
    if (saved.requestKey !== key) throw new ExperienceError(409, "operation_conflict");
    return this.acknowledgement(record, saved.revision);
  }
  private async state(user: Types.ObjectId, input: WearInput, snapshotId: string, candidateId: string,
    composition: ResolvedComposition, previous?: WearState): Promise<WearState> {
    let context;
    if (input.context.kind === "user") context = userWearContext(input.context.text);
    else {
      try { context = suggestedWearContext((await requireSource(user, snapshotId, candidateId)).snapshot.occasion ?? "", input.context.confirmed); }
      catch (error) {
        // A correction of date/outcome/composition must not be blocked by a later source
        // redaction. Only the unchanged suggestion-context choice can be carried forward.
        if (!(error instanceof ExperienceError && error.code === "source_unavailable" && previous?.context.source === "suggestion" &&
          previous.context.confirmed === input.context.confirmed)) throw error;
        context = previous.context.confirmed ? previous.context : suggestedWearContext("");
      }
    }
    return { occurredOn: input.occurredOn, timezone: input.timezone, context, outcome: input.outcome,
      compositionStatus: input.compositionStatus, ...(composition.memberItems ? { memberItems: composition.memberItems } : {}),
      learningDisposition: "do_not_learn" };
  }
  async create(ownerId: string, raw: unknown): Promise<ExperienceAcknowledgement> {
    const user = await this.owner(ownerId);
    const input = createInput(raw, this.now());
    const key = JSON.stringify({ type: "create", ...input });
    const previous = await this.find(user, input.experienceId);
    const replay = this.replay(previous, input.operationId, key);
    if (replay) return replay;
    if (previous) throw new ExperienceError(409, "experience_exists");
    const composition = await resolveComposition(user, input, input.snapshotId, input.candidateId);
    const state = await this.state(user, input, input.snapshotId, input.candidateId, composition);
    const record: ExperienceRecord = {
      _id: new Types.ObjectId(), user, experienceId: input.experienceId, lifecycle: "active", schemaVersion: 1,
      snapshotId: new Types.ObjectId(input.snapshotId), candidateId: input.candidateId,
      memberItemIds: composition.memberItemIds, currentRevision: 1,
      revisions: [{ revision: 1, operationId: input.operationId, requestKey: key, recordedAt: this.now(), type: "wear_reported", state }],
    };
    await new OutfitExperience(record).validate();
    await this.admit(user, input.experienceId);
    await this.options.beforeWrite?.("create");
    await this.ownedWrite(user, "create", async () => {
      try { await ownerWriteFence(User, user, session => experienceCollection().insertOne(record, { session })); }
      catch (error) { if (!duplicate(error)) throw error; }
    });
    const current = await this.find(user, input.experienceId);
    const result = this.replay(current, input.operationId, key);
    if (!result) throw new ExperienceError(409, "experience_exists");
    return result;
  }
  async revise(ownerId: string, id: string, raw: unknown) {
    return this.change(ownerId, id, raw, "revise");
  }
  async retract(ownerId: string, id: string, raw: unknown) {
    return this.change(ownerId, id, raw, "retract");
  }
  private async change(ownerId: string, id: string, raw: unknown, type: "revise" | "retract"): Promise<ExperienceAcknowledgement> {
    const user = await this.owner(ownerId);
    id = operationId(id);
    const edited = type === "revise" ? editInput(raw, this.now()) : undefined;
    const input = edited ?? retractInput(raw);
    const key = JSON.stringify({ type, ...input });
    const previous = await this.find(user, id);
    const replay = this.replay(previous, input.operationId, key);
    if (replay) { await this.redactDerived(user, id, previous!.lifecycle === "active" ? previous!.currentRevision : undefined); return replay; }
    if (!previous) throw new ExperienceError(404, "experience_unavailable");
    if (previous.lifecycle !== "active" || previous.currentRevision !== input.expectedPreviousRevision) throw new ExperienceError(409, "revision_conflict");
    if (type === "revise" && previous.currentRevision >= MAX_EXPERIENCE_REVISIONS) throw new ExperienceError(409, "revision_capacity");
    const lastState = previous.revisions![previous.revisions!.length - 1].state;
    // A context/outcome correction may keep historical members after their closet row or source
    // is removed. A membership change must be checked against a live shown source and current owner.
    const sameChanged = edited?.compositionStatus === "changed" && lastState.compositionStatus === "changed" &&
      edited.memberItemIds?.length === previous.memberItemIds?.length &&
      edited.memberItemIds?.every((id, i) => id === String(previous.memberItemIds![i]));
    const sameShown = edited?.compositionStatus === "as_shown" && lastState.compositionStatus === "as_shown";
    const composition: ResolvedComposition = sameChanged || sameShown
      ? { memberItemIds: previous.memberItemIds!, memberItems: lastState.memberItems }
      : edited ? await resolveComposition(user, edited, previous.snapshotId!.toHexString(), previous.candidateId!)
        : { memberItemIds: previous.memberItemIds!, memberItems: lastState.memberItems };
    const state = edited
      ? await this.state(user, edited, previous.snapshotId!.toHexString(), previous.candidateId!, composition, lastState)
      : lastState;
    const revision: ExperienceRevision = { revision: previous.currentRevision! + 1, operationId: input.operationId, requestKey: key, recordedAt: this.now(), type: type === "revise" ? "revised" : "retracted", state };
    const lifecycle = type === "retract" ? "retracted" : "active";
    await new OutfitExperience({ ...previous, lifecycle, memberItemIds: composition.memberItemIds,
      currentRevision: revision.revision, revisions: [...previous.revisions!, revision] }).validate();
    await this.options.beforeWrite?.(type);
    await this.ownedWrite(user, type, () => experienceCollection().updateOne({
      user, experienceId: id, lifecycle: "active", currentRevision: input.expectedPreviousRevision,
      "revisions.operationId": { $ne: input.operationId },
    }, { $set: { lifecycle, memberItemIds: composition.memberItemIds,
      currentRevision: revision.revision }, $push: { revisions: revision } }));
    const current = await this.find(user, id);
    const result = this.replay(current, input.operationId, key);
    if (!result) throw new ExperienceError(409, "revision_conflict");
    await this.redactDerived(user, id, current!.lifecycle === "active" ? current!.currentRevision : undefined);
    return result;
  }
  private allowMissingMarker(user: string): boolean {
    const minute = Math.floor(this.now().getTime() / 60_000);
    const bucket = missingMarkerBuckets.get(user);
    if (bucket?.minute === minute) return ++bucket.count <= 20;
    if (missingMarkerBuckets.size >= 1000) missingMarkerBuckets.delete(missingMarkerBuckets.keys().next().value!);
    missingMarkerBuckets.set(user, { minute, count: 1 });
    return true;
  }
  async erase(ownerId: string, id: string): Promise<void> {
    const user = await this.owner(ownerId);
    id = operationId(id);
    if (!await this.find(user, id) && !this.allowMissingMarker(user.toHexString()) && !await this.find(user, id)) {
      throw new ExperienceError(429, "marker_rate_limit");
    }
    if (!await this.find(user, id)) await this.admit(user, id);
    const marker: ExperienceRecord = { user, experienceId: id, lifecycle: "erased" };
    await new OutfitExperience(marker).validate();
    await this.options.beforeWrite?.("erase");
    await this.ownedWrite(user, "erase", async () => {
      try { await ownerWriteFence(User, user, session => experienceCollection().replaceOne({ user, experienceId: id }, marker, { upsert: true, session })); }
      catch (error) {
        if (!duplicate(error)) throw error;
        // Duplicate-key aborted the first transaction. Erase the winner in a NEW fenced
        // transaction; never write again inside an aborted session.
        await ownerWriteFence(User, user, session => experienceCollection().replaceOne({ user, experienceId: id }, marker, { upsert: true, session }));
      }
    });
    await this.redactDerived(user, id);
  }
}
