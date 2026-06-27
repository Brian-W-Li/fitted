/**
 * M4b C7 — User cascade: a user delete hard-deletes their wardrobeimages (the H14 arm),
 * alongside the existing wardrobeitems + outfitinteractions cascade.
 *
 * No DB harness in this repo, so we exercise the exported cascade function + the EXACT
 * registered pre-hook directly, with a stub connection that records every deleteMany.
 *
 * Reference: docs/plans/m4-data-model-migration.md §14 (C7); §14.4 (H14).
 */
import { Types } from "mongoose";
import User, { cascadeDeleteUserData, cascadeUserDataHook } from "@/models/User";

function stubDb() {
  const calls: Record<string, Record<string, unknown>[]> = {};
  return {
    calls,
    collection(name: string) {
      return {
        deleteMany: async (filter: Record<string, unknown>) => {
          (calls[name] ||= []).push(filter);
          return { acknowledged: true, deletedCount: 0 };
        },
      };
    },
  };
}

describe("User cascade — cascadeDeleteUserData", () => {
  it("hard-deletes wardrobeitems, outfitinteractions, AND wardrobeimages", async () => {
    const db = stubDb();
    const userId = new Types.ObjectId();

    await cascadeDeleteUserData(db, userId);

    expect(db.calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(db.calls.outfitinteractions).toEqual([{ user: userId }]);
    expect(db.calls.wardrobeimages).toEqual([{ user: userId }]); // the C7 arm
  });

  it("does NOT cascade generationsnapshots (redaction is the Privacy path, not a hard delete)", async () => {
    const db = stubDb();
    await cascadeDeleteUserData(db, new Types.ObjectId());
    expect(db.calls.generationsnapshots).toBeUndefined();
  });
});

describe("User cascade — the registered hook", () => {
  it("is registered for deleteOne and findOneAndDelete", () => {
    const pres = (User.schema as unknown as { s: { hooks: { _pres: Map<string, unknown[]> } } }).s.hooks
      ._pres;
    expect((pres.get("deleteOne") || []).length).toBeGreaterThan(0);
    expect((pres.get("findOneAndDelete") || []).length).toBeGreaterThan(0);
  });

  it("the hook cascades all three collections then calls next (covers both delete paths)", async () => {
    // Both User.deleteOne (direct) and deleteUserWithData (→ User.deleteOne) fire this same hook.
    const db = stubDb();
    const userId = new Types.ObjectId();
    const next = jest.fn();

    await cascadeUserDataHook.call({ getQuery: () => ({ _id: userId }), model: { db } }, next);

    expect(db.calls.wardrobeimages).toEqual([{ user: userId }]);
    expect(db.calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(db.calls.outfitinteractions).toEqual([{ user: userId }]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the delete query carries no _id", async () => {
    const db = stubDb();
    const next = jest.fn();
    await cascadeUserDataHook.call({ getQuery: () => ({}), model: { db } }, next);
    expect(db.calls).toEqual({});
    expect(next).toHaveBeenCalledTimes(1);
  });
});
