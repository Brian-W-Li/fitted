import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    authProvider: { type: String, default: "firebase" },
    authId: { type: String, required: true },
    email: { type: String, required: true },
    displayName: { type: String },
    photoURL: { type: String },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ authProvider: 1, authId: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });

/**
 * Cascade delete: remove all wardrobe items and outfit interactions
 * when a user is deleted via deleteOne() or findOneAndDelete().
 */
UserSchema.pre(["deleteOne", "findOneAndDelete"], async function (next) {
  const query = this.getQuery();
  const userId = query._id;
  if (userId) {
    // Access the db connection from the model attached to this query
    const db = this.model.db;
    await db.collection("wardrobeitems").deleteMany({ user: userId });
    await db.collection("outfitinteractions").deleteMany({ user: userId });
  }
  next();
});

export type UserDocument = InferSchemaType<typeof UserSchema>;

const User = models.User || model("User", UserSchema);
export default User;
