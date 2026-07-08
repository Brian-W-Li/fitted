import { Schema, model, models, type InferSchemaType } from "mongoose";

const PerItemFeedbackSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "WardrobeItem" },
    disliked: { type: Boolean, default: false },
    notes: { type: String },
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
    items: [{ type: Schema.Types.ObjectId, ref: "WardrobeItem", required: true }],
    action: {
      type: String,
      required: true,
      enum: [
        "generated",
        "accepted",
        "rejected",
        "saved",
        "worn",
        "rated",
        // M4 additive (scoped-feedback events); behavior wired at M5.
        "planned",
        "packed",
        "corrected",
      ],
    },
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String },
    /** One-off "why" for this event: inferred by Gemini (what went right or wrong). */
    inferredWhy: { type: String },
    /** Per-item feedback from the dislike modal: which pieces the user marked as disliked and any notes. */
    perItemFeedback: { type: [PerItemFeedbackSchema], default: undefined },
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
  const presentCount = [
    this.snapshotId,
    this.candidateId,
    this.baseKey,
    this.fullSignature,
  ].filter((v) => v !== undefined && v !== null && v !== "").length;

  if (presentCount !== 0 && presentCount !== 4) {
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
