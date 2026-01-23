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

export type UserDocument = InferSchemaType<typeof UserSchema>;

const User = models.User || model("User", UserSchema);
export default User;
