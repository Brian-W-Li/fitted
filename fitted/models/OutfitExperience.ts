import { Schema, model, models, type Model, type Types } from "mongoose";
import type { WearState } from "@/lib/outfitExperience/contract";
import { MAX_EXPERIENCE_REVISIONS } from "@/lib/outfitExperience/contract";

export interface ExperienceRevision {
  revision: number;
  operationId: string;
  requestKey: string;
  recordedAt: Date;
  type: "wear_reported" | "revised" | "retracted";
  state: WearState;
}
export interface ExperienceRecord {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  experienceId: string;
  lifecycle: "active" | "retracted" | "erased";
  schemaVersion?: number;
  snapshotId?: Types.ObjectId;
  candidateId?: string;
  memberItemIds?: Types.ObjectId[];
  currentRevision?: number;
  revisions?: ExperienceRevision[];
}
const contextSchema = new Schema({
  rawOccasion: { type: String, maxlength: 200 }, exactScopeKey: { type: String, maxlength: 200, default: null },
  source: { type: String, enum: ["user", "suggestion"], required: true },
  confirmed: { type: Boolean, required: true }, version: { type: Number, enum: [1], required: true },
}, { _id: false, strict: "throw" });
const actualItemSchema = new Schema({
  itemId: { type: String, required: true }, name: { type: String, required: true, maxlength: 200 },
  clothingType: { type: String, required: true },
  role: { type: String, enum: ["base_top", "mid_layer"] },
}, { _id: false, strict: "throw" });
const stateSchema = new Schema({
  occurredOn: { type: String, required: true }, timezone: { type: String, required: true, maxlength: 100 },
  context: { type: contextSchema, required: true },
  outcome: { type: String, enum: ["worked", "change_next_time", "unknown"], required: true },
  compositionStatus: { type: String, enum: ["as_shown", "changed"], required: true },
  memberItems: { type: [actualItemSchema], default: undefined },
  learningDisposition: { type: String, enum: ["do_not_learn"], required: true },
}, { _id: false, strict: "throw" });
const revisionSchema = new Schema({
  revision: { type: Number, required: true, min: 1, max: MAX_EXPERIENCE_REVISIONS + 1 },
  operationId: { type: String, required: true, maxlength: 64 },
  requestKey: { type: String, required: true, maxlength: 4000 },
  recordedAt: { type: Date, required: true },
  type: { type: String, enum: ["wear_reported", "revised", "retracted"], required: true },
  state: { type: stateSchema, required: true },
}, { _id: false, strict: "throw" });
const schema = new Schema<ExperienceRecord>({
  user: { type: Schema.Types.ObjectId, required: true },
  experienceId: { type: String, required: true, maxlength: 64 },
  lifecycle: { type: String, enum: ["active", "retracted", "erased"], required: true },
  schemaVersion: { type: Number, enum: [1] }, snapshotId: Schema.Types.ObjectId,
  candidateId: { type: String, maxlength: 128 },
  memberItemIds: { type: [Schema.Types.ObjectId], default: undefined },
  currentRevision: { type: Number, min: 1, max: MAX_EXPERIENCE_REVISIONS + 1 },
  revisions: { type: [revisionSchema], default: undefined },
}, { strict: "throw", versionKey: false });

schema.pre("validate", function(next) {
  const content = [this.schemaVersion, this.snapshotId, this.candidateId, this.memberItemIds, this.currentRevision, this.revisions];
  const latest = this.revisions?.[this.revisions.length - 1].state;
  if (this.lifecycle === "erased") {
    if (content.some(x => x !== undefined)) return next(new Error("Erased markers must contain no experience content"));
  } else if (content.some(x => x === undefined) || !this.memberItemIds?.length ||
    !this.revisions?.length || this.revisions.length > MAX_EXPERIENCE_REVISIONS + 1 ||
    this.currentRevision !== this.revisions.length ||
    this.revisions.some((r, i) => r.revision !== i + 1) ||
    new Set(this.revisions.map(r => r.operationId)).size !== this.revisions.length ||
    (latest?.compositionStatus === "changed" && !latest.memberItems?.length) ||
    (latest?.memberItems && latest.memberItems.map(item => item.itemId).join(",") !== this.memberItemIds?.map(String).join(","))) {
    return next(new Error("Invalid experience revision sequence"));
  }
  next();
});
schema.index({ user: 1, experienceId: 1 }, { unique: true });
schema.index({ user: 1, lifecycle: 1, memberItemIds: 1, _id: -1 });
schema.index({ user: 1, lifecycle: 1, _id: -1 });

const OutfitExperience = (models.OutfitExperience as Model<ExperienceRecord> | undefined) || model<ExperienceRecord>("OutfitExperience", schema);
export default OutfitExperience;

export function experienceCollection() {
  const db = OutfitExperience.db.db;
  if (!db) throw new Error("Experience storage requires an initialized database");
  return db.collection<ExperienceRecord>(OutfitExperience.collection.name);
}

// Production disables Mongoose autoIndex. The writer must explicitly ensure the
// unique key before admitting any mutation; init() alone cannot provide that guarantee.
const indexReadiness = new WeakMap<object, Promise<void>>();
export async function ensureExperienceIndexes(): Promise<void> {
  const db = OutfitExperience.db.db;
  if (!db) throw new Error("Experience storage requires an initialized database");
  let ready = indexReadiness.get(db);
  if (!ready) {
    ready = OutfitExperience.createIndexes().then(() => undefined);
    indexReadiness.set(db, ready);
  }
  try { await ready; }
  catch (error) {
    if (indexReadiness.get(db) === ready) indexReadiness.delete(db);
    throw error;
  }
}
