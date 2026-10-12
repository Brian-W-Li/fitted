import { beginUserErasure, type ErasureOwner } from "@/lib/userErasure";
import { Schema, Types, model, models, type InferSchemaType } from "mongoose";

export interface OutfitPlanRecord {
  planId: string;
  lifecycle: "active" | "removed";
  revision?: number;
  snapshotId?: string;
  candidateId?: string;
  plannedFor?: string;
  timezone?: string;
  createKey?: string;
  operationId?: string;
  requestKey?: string;
}
const planSchema = new Schema<OutfitPlanRecord>({
  planId: { type: String, required: true },
  lifecycle: { type: String, enum: ["active", "removed"], required: true },
  revision: Number, snapshotId: String, candidateId: String, plannedFor: String, timezone: String,
  createKey: String, operationId: String, requestKey: String,
}, { _id: false, strict: "throw" });

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
    // Same-owner writes serialize owned-row admission against durable account erasure.
    erasureStarted: { type: Boolean, default: false },
    // Legacy name: shared conflict counter for image and non-image owned-row writes, not a photo count.
    imageWriteVersion: { type: Number, default: undefined, select: false },
    // Durable, bounded admission identities; erased IDs stay reserved against replay.
    experienceAdmissions: { type: [String], default: undefined, select: false },
    // Bounded intent references, separate from wear/reactions. Hidden from generic account reads.
    outfitPlans: { type: [planSchema], default: undefined, select: false },
    planningVersion: { type: Number, default: undefined, select: false },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ authProvider: 1, authId: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });

// Minimal structural view of the connection the cascade needs (a real Mongoose Connection is
// assignable to it; focused tests can also supply a stub).
type CascadeDb = {
  collection: (name: string) => { deleteMany: (filter: Record<string, unknown>, options?: { writeConcern: { w: "majority" } }) => Promise<unknown> };
};

/** Majority-sweep the owner's cascade collections only after its erasure barrier.
 * Native deletes are the sanctioned snapshot-erasure door below the immutability guard;
 * redaction remains the non-erasure removal tool and account-deletion fail-safe.
 * The final User hook repeats this sweep. Photo admission is fenced transactionally;
 * other writers' uncertain late outcomes remain a separate lifecycle limit.
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
  await db.collection("wardrobeitems").deleteMany({ user: id }, { writeConcern: { w: "majority" } });
  await db.collection("outfitinteractions").deleteMany({ user: id }, { writeConcern: { w: "majority" } });
  await db.collection("wardrobeimages").deleteMany({ user: id }, { writeConcern: { w: "majority" } });
  await db.collection("generationsnapshots").deleteMany({ user: id }, { writeConcern: { w: "majority" } });
  await db.collection("outfitexperiences").deleteMany({ user: id }, { writeConcern: { w: "majority" } });
}

/**
 * Cascade hook: fires on a user delete via `deleteOne()` or `findOneAndDelete()` — both the
 * direct `User.deleteOne` and `lib/db.ts` `deleteUserWithData` (which calls `User.deleteOne`)
 * paths run this. Named + exported so a test can invoke the exact registered hook.
 */
export async function cascadeUserDataHook(
  this: {
    getQuery: () => Record<string, unknown>;
    setQuery: (query: Record<string, unknown>) => void;
    getOptions: () => Record<string, unknown>;
    setOptions: (options: { writeConcern: { w: "majority" } }) => unknown;
    model: ErasureOwner & {
      db: CascadeDb;
      findOne: (query: Record<string, unknown>) => {
        select: (fields: string) => { lean: () => PromiseLike<{ _id: unknown } | null> };
      };
    };
  },
  next: (err?: Error) => void,
): Promise<void> {
  // The barrier must commit independently BEFORE native cascade writes. A caller-owned
  // transaction could roll it back after bytes have already been swept, so fail closed.
  const options = this.getOptions();
  if (options.session) throw new Error("Account erasure cannot run inside a transaction");
  // The supported door resolves the normal model filter. Reject selection semantics we
  // do not reproduce rather than erasing a different owner than the caller requested.
  if (["sort", "collation", "hint", "skip", "let"].some(key => options[key] !== undefined)) {
    throw new Error("Unsupported account erasure query options");
  }
  this.setOptions({ writeConcern: { w: "majority" } });
  const query = this.getQuery();
  const owner = await this.model.findOne(query).select("_id").lean();
  // Bind this operation to exactly the resolved owner, even for authId/email filters.
  // An initially absent owner cannot turn into an unfenced delete of a later matching row.
  this.setQuery({ $and: [query, { _id: owner ? owner._id : { $in: [] } }] });
  if (owner && await beginUserErasure(this.model, owner._id)) {
    await cascadeDeleteUserData(this.model.db, owner._id);
  }
  next();
}

UserSchema.pre(["deleteOne", "findOneAndDelete"], cascadeUserDataHook);

export type UserDocument = InferSchemaType<typeof UserSchema>;

const User = models.User || model("User", UserSchema);
export default User;
