import { Schema, Types, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    authProvider: { type: String, default: "firebase" },
    authId: { type: String, required: true },
    email: { type: String, required: true },
    displayName: { type: String },
    photoURL: { type: String },
    // Monotonic per-user counter; bumps only when a wardrobe change becomes sampler-visible.
    // M4 stores the field (default 0); the bump trigger is named by the W-track (spec §23-H6).
    wardrobeVersion: { type: Number, default: 0 },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ authProvider: 1, authId: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });

// Minimal structural view of the connection the cascade needs (a real Mongoose Connection is
// assignable to it; a stub is trivial to build in tests — there is no DB harness here).
type CascadeDb = {
  collection: (name: string) => { deleteMany: (filter: Record<string, unknown>) => Promise<unknown> };
};

/**
 * Cascade-delete every collection a user owns. Exported (and the hook delegates to it) so the
 * cascade is unit-testable without a live DB. On user delete we hard-delete wardrobe items,
 * outfit interactions, wardrobe images (H14's cascade arm, M4b C7), AND generation snapshots.
 *
 * The generationsnapshots arm is the SINGLE SANCTIONED ERASURE DOOR through the snapshot
 * immutability/delete guard (§23-H43, Track 2 policy): user-invoked account deletion means
 * "delete me" — the snapshots ARE the outfit history and retain the user's own text (item
 * names, occasion notes, raw generation text), so they are erased, not just redacted. This
 * runs on the NATIVE driver, deliberately below the Mongoose delete guard — exactly like the
 * other cascade arms. Redaction (`redacted:true`) remains the tool for non-erasure removal
 * (corpus hygiene) and as the account route's phase-1 fail-safe. The image-replacement
 * delete-before-commit ordering bug stays W-track (§14.4-H14).
 */
export async function cascadeDeleteUserData(db: CascadeDb, userId: unknown): Promise<void> {
  // These deleteMany calls hit the NATIVE driver collections (`this.model.db`), which perform NO
  // Mongoose casting — a hex-string user id (the API routes' representation, sanctioned by
  // `deleteUserWithData`'s `UserId = ObjectId | string` type) would match zero ObjectId-typed
  // `user` fields and the cascade would silently delete nothing (caught by the DELETE /api/account
  // behavioral test). Cast at this single choke point.
  const id =
    typeof userId === "string" && /^[0-9a-fA-F]{24}$/.test(userId)
      ? new Types.ObjectId(userId)
      : userId;
  await db.collection("wardrobeitems").deleteMany({ user: id });
  await db.collection("outfitinteractions").deleteMany({ user: id });
  await db.collection("wardrobeimages").deleteMany({ user: id });
  await db.collection("generationsnapshots").deleteMany({ user: id });
}

/**
 * Cascade hook: fires on a user delete via `deleteOne()` or `findOneAndDelete()` — both the
 * direct `User.deleteOne` and `lib/db.ts` `deleteUserWithData` (which calls `User.deleteOne`)
 * paths run this. Named + exported so a test can invoke the exact registered hook.
 */
export async function cascadeUserDataHook(
  this: { getQuery: () => { _id?: unknown }; model: { db: CascadeDb } },
  next: (err?: Error) => void,
): Promise<void> {
  const userId = this.getQuery()._id;
  if (userId) await cascadeDeleteUserData(this.model.db, userId);
  next();
}

UserSchema.pre(["deleteOne", "findOneAndDelete"], cascadeUserDataHook);

export type UserDocument = InferSchemaType<typeof UserSchema>;

const User = models.User || model("User", UserSchema);
export default User;
