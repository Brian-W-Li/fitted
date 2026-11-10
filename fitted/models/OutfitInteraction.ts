import { Schema, model, models, type InferSchemaType } from "mongoose";
import { FEEDBACK_SCOPES, FEEDBACK_CONCERNS } from "@/lib/feedbackTypes";

const PerItemFeedbackSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "WardrobeItem" },
    disliked: { type: Boolean, default: false },
    notes: { type: String },
  },
  { _id: false, timestamps: false },
);

// --- M5 §16 structured feedback "why" (C6). The closed reason vocabulary + a bounded free-text
// escape hatch. This is the sanctioned home for the "why" (never `metadata`, never the deleted
// Gemini `inferredWhy` write-back). M5 reducers ignore `feedbackReason` in v1; future training reads
// the structured `codes`, while `rawText` stays provenance until reviewed/compiled (§23-H34). ---
export const FEEDBACK_REASON_CODES = [
  "good",
  "neutral",
  "bad",
  "too_boring",
  "too_much",
  "not_practical",
  "not_me",
  "wrong_context",
  "weather_forced",
  "necessity",
  "too_repetitive",
] as const;
export type FeedbackReasonCode = (typeof FEEDBACK_REASON_CODES)[number];
export const FEEDBACK_REASON_RAW_TEXT_MAX_CHARS = 500; // same route cap as perItemFeedback.notes

const FeedbackReasonSchema = new Schema(
  {
    codes: [{ type: String, enum: [...FEEDBACK_REASON_CODES] }],
    // Declaration scope is evidence only. It never becomes a category ban or a vote.
    scope: { type: String, enum: [...FEEDBACK_SCOPES] },
    itemId: { type: Schema.Types.ObjectId, ref: "WardrobeItem" },
    concern: { type: String, enum: [...FEEDBACK_CONCERNS] },
    rawText: { type: String, maxlength: FEEDBACK_REASON_RAW_TEXT_MAX_CHARS },
    source: { type: String, enum: ["user"], default: "user" },
  },
  { _id: false, timestamps: false },
);

const ContextSchema = new Schema(
  {
    weather: { type: String },
    temperatureF: { type: Number },
    location: { type: String },
    occasion: { type: String },
    notes: { type: String },
  },
  { _id: false, timestamps: false },
);

const OutfitInteractionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Absent kind remains a legacy vote. Reasons are separately appended evidence.
    eventKind: { type: String, enum: ["reaction", "reason_amendment", "learning_disposition"], default: undefined },
    reactionId: { type: Schema.Types.ObjectId },
    operationId: { type: String, maxlength: 64 },
    requestKey: { type: String },
    items: [{ type: Schema.Types.ObjectId, ref: "WardrobeItem", required: true }],
    action: {
      type: String,
      required: function () { return this.eventKind !== "reason_amendment" && this.eventKind !== "learning_disposition"; },
      // M5 (C8) trimmed the dead CS148 legacy verbs (generated/saved/worn/rated) and `corrected`.
      // The live write path (POST /api/interactions, G8 allowlist) emits only accepted|rejected;
      // `corrected` was superseded by H61 (a correction is a NEW accepted|rejected event keyed
      // per-candidate, not its own action — keeping it invited a reducer-contract violation).
      // `planned`/`packed` are retained [STAGED] scaffolding for the north-star board/routine
      // feedback surface; decide them as one unit with the `scopeTarget` board/routine vocab at M6.
      enum: [
        "accepted",
        "rejected",
        "planned",
        "packed",
      ],
    },
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String },
    /** DORMANT (C8): its Gemini writer (`lib/gemini.ts`) was deleted; the structured `feedbackReason`
     *  below is the sanctioned "why" home. Column kept for any pre-C8 rows; no live write path. */
    inferredWhy: { type: String },
    /** Per-item feedback from the dislike modal: which pieces the user marked as disliked and any notes. */
    perItemFeedback: { type: [PerItemFeedbackSchema], default: undefined },
    /** Structured "why" (§16): closed reason codes + bounded free text. The C6 route validates codes
     *  against FEEDBACK_REASON_CODES and caps rawText; written only when at least one exists. */
    feedbackReason: { type: FeedbackReasonSchema, default: undefined },
    context: { type: ContextSchema, default: () => ({}) },

    // --- M4 snapshot binding (all nullable; present iff snapshot-bound). ---
    // Co-presence invariant: all four present (a bound row) or all four absent (a pre-M5 legacy row).
    // The GenerationSnapshot model lands at C5; the ref is a string label, harmless until then.
    snapshotId: { type: Schema.Types.ObjectId, ref: "GenerationSnapshot" },
    candidateId: { type: String },
    baseKey: { type: String },
    fullSignature: { type: String },

    // --- M4 scope-vocab (additive nullable; learning behavior is [STAGED], wired later). ---
    scopeTarget: {
      type: String,
      enum: ["outfit", "board", "routine", "global", "lens"],
    },
    learningDisposition: {
      type: String,
      enum: ["normal", "exception", "do_not_learn"],
    },
    dispositionRevision: { type: Number, min: 0, validate: Number.isSafeInteger, default: undefined },
    styleContext: { type: Schema.Types.Mixed, default: undefined },

    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

/**
 * Binding co-presence guard: the four snapshot-binding fields must be all-present
 * (a snapshot-bound feedback row) or all-absent (a pre-M5 legacy row). A partial row
 * would poison the live affinity/cooldown projections that read these fields.
 *
 * NOTE (M5): `pre('validate')` runs on `.create()`/`.save()` but NOT on
 * `updateOne`/`findOneAndUpdate`/`insertMany` (those skip document middleware unless
 * `runValidators:true`, which still wouldn't run THIS hook). M5 must write
 * snapshot-bound feedback via `.create()`/`.save()` so this guard fires.
 * Empty strings count as absent (an empty join key is not a real binding).
 */
OutfitInteractionSchema.pre("validate", function (next) {
  const amendment = this.eventKind === "reason_amendment" || this.eventKind === "learning_disposition";
  if (amendment &&
      (!this.reactionId || !this.operationId || !this.requestKey || this.action != null)) {
    return next(new Error("Reason amendments require a target and operation, and cannot carry a vote"));
  }
  if (!amendment && (this.reactionId || this.operationId || this.requestKey)) {
    return next(new Error("Reaction rows cannot carry amendment fields"));
  }
  if (this.eventKind === "learning_disposition" &&
    (!this.learningDisposition || !Number.isSafeInteger(this.dispositionRevision) || this.dispositionRevision! < 1 || this.feedbackReason != null || this.perItemFeedback != null)) {
    return next(new Error("Learning amendments require a disposition revision and cannot carry reasons or a vote"));
  }
  const reason = this.feedbackReason;
  if (reason?.scope) {
    if (!reason.concern || (reason.scope === "item" ? !reason.itemId || !this.items.some(item => String(item) === String(reason.itemId)) : reason.itemId != null) ||
        (reason.concern === "fit" && reason.scope !== "item")) {
      return next(new Error("Scoped reasons require a bound target and an item for personal fit"));
    }
  } else if (reason?.itemId != null || reason?.concern != null) {
    return next(new Error("Reason target and concern require an explicit scope"));
  }
  const presentCount = [
    this.snapshotId,
    this.candidateId,
    this.baseKey,
    this.fullSignature,
  ].filter((v) => v !== undefined && v !== null && v !== "").length;

  if ((amendment && presentCount !== 4) || (presentCount !== 0 && presentCount !== 4)) {
    return next(
      new Error(
        "OutfitInteraction binding fields must be all present or all absent " +
          "(snapshotId, candidateId, baseKey, fullSignature).",
      ),
    );
  }
  next();
});

// M5 §H reducer window: deterministic most-recent-first scan. The _id tie-break
// matters for same-millisecond feedback writes at the scan/cooldown boundary.
OutfitInteractionSchema.index({ user: 1, createdAt: -1, _id: -1 });
OutfitInteractionSchema.index({ user: 1, items: 1 });
// Snapshot -> feedback join (M6 training reads); additive, builds via autoIndex.
OutfitInteractionSchema.index({ snapshotId: 1, candidateId: 1 });

export type OutfitInteractionDocument = InferSchemaType<typeof OutfitInteractionSchema>;

const OutfitInteraction =
  models.OutfitInteraction || model("OutfitInteraction", OutfitInteractionSchema);
export default OutfitInteraction;
