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

function hookContext(db: ReturnType<typeof stubDb>, userId?: unknown, query: Record<string, unknown> = {}) {
  const barrier = jest.fn(async () => ({ matchedCount: 1 }));
  return {
    getQuery: () => query,
    setQuery: jest.fn(),
    getOptions: () => ({}),
    setOptions: jest.fn(),
    model: {
      db, updateOne: barrier,
      findOne: () => ({ select: () => ({ lean: async () => userId ? { _id: userId } : null }) }),
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
    expect(db.calls.outfitexperiences).toEqual([{ user: userId }]);
  });
});

describe("User cascade — the registered hook", () => {
  it("is registered for deleteOne and findOneAndDelete", () => {
    const pres = (User.schema as unknown as { s: { hooks: { _pres: Map<string, unknown[]> } } }).s.hooks
      ._pres;
    expect((pres.get("deleteOne") || []).length).toBeGreaterThan(0);
    expect((pres.get("findOneAndDelete") || []).length).toBeGreaterThan(0);
  });

  it("the hook cascades all owned collections then calls next (covers both delete paths)", async () => {
    // Both User.deleteOne (direct) and deleteUserWithData (→ User.deleteOne) fire this same hook.
    const db = stubDb();
    const userId = new Types.ObjectId();
    const next = jest.fn();

    const context = hookContext(db, userId, { _id: userId });
    await cascadeUserDataHook.call(context, next);
    expect(context.model.updateOne).toHaveBeenCalledWith({ _id: userId }, { $set: { erasureStarted: true } }, { writeConcern: { w: "majority" } });
    expect(context.setQuery).toHaveBeenCalledWith({ $and: [{ _id: userId }, { _id: userId }] });

    expect(db.calls.wardrobeimages).toEqual([{ user: userId }]);
    expect(db.calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(db.calls.outfitinteractions).toEqual([{ user: userId }]);
    expect(db.calls.generationsnapshots).toEqual([{ user: userId }]);
    expect(db.calls.outfitexperiences).toEqual([{ user: userId }]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("binds an absent owner to an impossible delete predicate", async () => {
    const db = stubDb();
    const next = jest.fn();
    const context = hookContext(db);
    await cascadeUserDataHook.call(context, next);
    expect(context.setQuery).toHaveBeenCalledWith({ $and: [{}, { _id: { $in: [] } }] });
    expect(context.model.updateOne).not.toHaveBeenCalled();
    expect(db.calls).toEqual({});
    expect(next).toHaveBeenCalledTimes(1);
  });
});
