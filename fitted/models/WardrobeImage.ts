import { Schema, model, models, type InferSchemaType } from "mongoose";

const WardrobeImageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    wardrobeItem: { type: Schema.Types.ObjectId, ref: "WardrobeItem", required: true, index: true },

    base64: { type: String, required: true },        // raw base64 only
    contentType: { type: String, required: true },   // "image/jpeg", "image/png", ...
    sizeBytes: { type: Number, required: true },     // original bytes length (before base64)
  },
  { timestamps: true },
);

WardrobeImageSchema.index({ user: 1, wardrobeItem: 1 });

export type WardrobeImageDocument = InferSchemaType<typeof WardrobeImageSchema>;

const WardrobeImage = models.WardrobeImage || model("WardrobeImage", WardrobeImageSchema);
export default WardrobeImage;