import { Schema, model, models, type InferSchemaType } from "mongoose";

const PerItemFeedbackSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "WardrobeItem", required: true },
    liked: { type: Boolean },
    disliked: { type: Boolean },
    notes: { type: String },
    layerRole: { type: String },
  },
  { _id: false }
);

const EnvironmentContextSchema = new Schema(
  {
    temperatureHint: { 
      type: String, 
      enum: ["hot", "mild", "cold", "indoor"] 
    },
    weatherSummary: { type: String },
  },
  { _id: false }
);

const UserOutfitFeedbackSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    itemIds: [{ type: Schema.Types.ObjectId, ref: "WardrobeItem", required: true }],
    feedbackType: {
      type: String,
      required: true,
      enum: ["like", "dislike"],
    },
    eventDescription: { type: String },
    environment: { type: EnvironmentContextSchema },
    perItemFeedback: [{ type: PerItemFeedbackSchema }],
    overallNotes: { type: String },
    lockedItemIds: [{ type: Schema.Types.ObjectId, ref: "WardrobeItem" }],
    regenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

UserOutfitFeedbackSchema.index({ user: 1, createdAt: -1 });
UserOutfitFeedbackSchema.index({ user: 1, feedbackType: 1 });

export type UserOutfitFeedbackDocument = InferSchemaType<typeof UserOutfitFeedbackSchema>;

const UserOutfitFeedback =
  models.UserOutfitFeedback || model("UserOutfitFeedback", UserOutfitFeedbackSchema);
export default UserOutfitFeedback;
