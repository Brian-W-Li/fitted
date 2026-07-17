/**
 * User cascade: a user delete hard-deletes their wardrobeimages (the H14 arm, M4b C7),
 * wardrobeitems, outfitinteractions, AND generationsnapshots (account-deletion erasure,
 * §23-H43 Track 2 policy — the single sanctioned door through the snapshot delete guard).
 *
 * We exercise the exported cascade function + the EXACT registered pre-hook directly, with a
 * stub connection that records every deleteMany.
 *
 * Reference: docs/plans/m4-data-model-migration.md §14 (C7); docs/Fitted_Spec_v2.md §23-H43.
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
  it("hard-deletes wardrobeitems, outfitinteractions, wardrobeimages, AND generationsnapshots", async () => {
    const db = stubDb();
    const userId = new Types.ObjectId();

    await cascadeDeleteUserData(db, userId);

    expect(db.calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(db.calls.outfitinteractions).toEqual([{ user: userId }]);
    expect(db.calls.wardrobeimages).toEqual([{ user: userId }]); // the C7 arm
    expect(db.calls.generationsnapshots).toEqual([{ user: userId }]); // §23-H43 erasure arm
  });
});

describe("User cascade — the registered hook", () => {
  it("is registered for deleteOne and findOneAndDelete", () => {
    const pres = (User.schema as unknown as { s: { hooks: { _pres: Map<string, unknown[]> } } }).s.hooks
      ._pres;
    expect((pres.get("deleteOne") || []).length).toBeGreaterThan(0);
    expect((pres.get("findOneAndDelete") || []).length).toBeGreaterThan(0);
  });

  it("the hook cascades all four collections then calls next (covers both delete paths)", async () => {
    // Both User.deleteOne (direct) and deleteUserWithData (→ User.deleteOne) fire this same hook.
    const db = stubDb();
    const userId = new Types.ObjectId();
    const next = jest.fn();

    await cascadeUserDataHook.call({ getQuery: () => ({ _id: userId }), model: { db } }, next);

    expect(db.calls.wardrobeimages).toEqual([{ user: userId }]);
    expect(db.calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(db.calls.outfitinteractions).toEqual([{ user: userId }]);
    expect(db.calls.generationsnapshots).toEqual([{ user: userId }]);
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
