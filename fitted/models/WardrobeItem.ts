import { Schema, model, models, type InferSchemaType } from "mongoose";

const WardrobeItemSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    clothingType: { type: String, enum: ["top", "bottom"], default: "top", index: true },
    category: { type: String, required: true, index: true },
    subCategory: { type: String },
    pattern: { type: String },
    colors: { type: [String], default: [] },
    seasons: { type: [String], default: [] },
    occasions: { type: [String], default: [] },
    // Optional layering role for tops/outerwear ("base", "mid", "outer"); may also be set for one-piece dresses.
    layerRole: { type: String },
    brand: { type: String },
    fit: { type: String },
    size: { type: String },
    imageUrl: { type: String },

    //New: points to WadrobeImage doc in mongodb where the image is
    imagePath: {type: String },

    notes: { type: String },
    tags: { type: [String], default: [] },
    isAvailable: { type: Boolean, default: true },
    isFavorite: { type: Boolean, default: false },
    lastWornAt: { type: Date },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

WardrobeItemSchema.index({ user: 1, category: 1 });
WardrobeItemSchema.index({ user: 1, tags: 1 });
WardrobeItemSchema.index({ user: 1, isFavorite: 1 });
WardrobeItemSchema.index({ user: 1, updatedAt: -1 });

export type WardrobeItemDocument = InferSchemaType<typeof WardrobeItemSchema>;

const WardrobeItem =
  models.WardrobeItem || model("WardrobeItem", WardrobeItemSchema);
export default WardrobeItem;
