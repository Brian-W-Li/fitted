import { Schema, model, models, type InferSchemaType } from "mongoose";

const PreferenceSummarySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    text: { type: String, default: "" },
    feedbackCount: { type: Number, default: 0 },
    lastFeedbackAt: { type: Date },
  },
  { timestamps: true }
);

export type PreferenceSummaryDocument = InferSchemaType<typeof PreferenceSummarySchema>;

const PreferenceSummary =
  models.PreferenceSummary || model("PreferenceSummary", PreferenceSummarySchema);
export default PreferenceSummary;
