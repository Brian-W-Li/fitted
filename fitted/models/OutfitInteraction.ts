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
      enum: ["generated", "accepted", "rejected", "saved", "worn", "rated"],
    },
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String },
    /** One-off "why" for this event: inferred by Gemini (what went right or wrong). */
    inferredWhy: { type: String },
    /** Per-item feedback from the dislike modal: which pieces the user marked as disliked and any notes. */
    perItemFeedback: { type: [PerItemFeedbackSchema], default: undefined },
    context: { type: ContextSchema, default: () => ({}) },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

OutfitInteractionSchema.index({ user: 1, createdAt: -1 });
OutfitInteractionSchema.index({ user: 1, items: 1 });

export type OutfitInteractionDocument = InferSchemaType<typeof OutfitInteractionSchema>;

const OutfitInteraction =
  models.OutfitInteraction || model("OutfitInteraction", OutfitInteractionSchema);
export default OutfitInteraction;
