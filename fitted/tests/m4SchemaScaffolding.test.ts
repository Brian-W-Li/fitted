/**
 * M4 C1 — schema scaffolding validation.
 *
 * Validates the migrated Mongoose schemas in memory (no DB connection):
 *   - validateSync() exercises path validators (enum / required / min / max).
 *   - validate() (async) additionally runs the pre("validate") co-presence guard.
 *
 * Reference: docs/plans/m4-data-model-migration.md §14 (C1).
 */
import { Types } from "mongoose";
import WardrobeItem from "@/models/WardrobeItem";
import User from "@/models/User";
import OutfitInteraction from "@/models/OutfitInteraction";

const oid = () => new Types.ObjectId();

describe("WardrobeItem — clothingType + warmth", () => {
  const base = () => ({
    user: oid(),
    name: "Test item",
    category: "top",
    warmth: 5,
  });

  it.each(["top", "bottom", "dress", "outer_layer", "shoes"])(
    "accepts clothingType=%s",
    (clothingType) => {
      const err = new WardrobeItem({ ...base(), clothingType }).validateSync();
      expect(err?.errors.clothingType).toBeUndefined();
    },
  );

  it("rejects a clothingType outside the 5-value enum", () => {
    const err = new WardrobeItem({ ...base(), clothingType: "hat" }).validateSync();
    expect(err?.errors.clothingType).toBeDefined();
  });

  it("requires warmth", () => {
    const err = new WardrobeItem({
      user: oid(),
      name: "Test item",
      category: "top",
    }).validateSync();
    expect(err?.errors.warmth).toBeDefined();
  });

  it.each([-1, 11])("rejects out-of-range warmth=%s", (warmth) => {
    const err = new WardrobeItem({ ...base(), warmth }).validateSync();
    expect(err?.errors.warmth).toBeDefined();
  });

  it.each([0, 5, 10])("accepts in-band warmth=%s", (warmth) => {
    const err = new WardrobeItem({ ...base(), warmth }).validateSync();
    expect(err?.errors.warmth).toBeUndefined();
  });

  it("a fully-populated item passes validation", () => {
    const err = new WardrobeItem({ ...base(), clothingType: "dress" }).validateSync();
    expect(err).toBeUndefined();
  });
});

describe("User — wardrobeVersion", () => {
  it("defaults wardrobeVersion to 0", () => {
    const u = new User({ authId: "abc", email: "a@b.com" });
    expect(u.wardrobeVersion).toBe(0);
  });
});

describe("OutfitInteraction — action enum + scope vocab", () => {
  const base = () => ({ user: oid(), items: [oid()], action: "accepted" });

  it.each(["planned", "packed", "corrected"])("accepts new action=%s", (action) => {
    const err = new OutfitInteraction({ ...base(), action }).validateSync();
    expect(err?.errors.action).toBeUndefined();
  });

  it("still accepts the original action values", () => {
    for (const action of ["generated", "accepted", "rejected", "saved", "worn", "rated"]) {
      const err = new OutfitInteraction({ ...base(), action }).validateSync();
      expect(err?.errors.action).toBeUndefined();
    }
  });

  it("rejects an action outside the enum", () => {
    const err = new OutfitInteraction({ ...base(), action: "swiped" }).validateSync();
    expect(err?.errors.action).toBeDefined();
  });

  it("accepts the scope-vocab enums and treats them as nullable", () => {
    const ok = new OutfitInteraction({
      ...base(),
      scopeTarget: "lens",
      learningDisposition: "exception",
    }).validateSync();
    expect(ok?.errors.scopeTarget).toBeUndefined();
    expect(ok?.errors.learningDisposition).toBeUndefined();

    // Absent is valid (legacy / [NOW] rows carry neither).
    const absent = new OutfitInteraction(base()).validateSync();
    expect(absent?.errors.scopeTarget).toBeUndefined();
    expect(absent?.errors.learningDisposition).toBeUndefined();
  });

  it("rejects an out-of-enum scopeTarget / learningDisposition", () => {
    const err = new OutfitInteraction({
      ...base(),
      scopeTarget: "everywhere",
      learningDisposition: "always",
    }).validateSync();
    expect(err?.errors.scopeTarget).toBeDefined();
    expect(err?.errors.learningDisposition).toBeDefined();
  });
});

describe("OutfitInteraction — binding co-presence guard", () => {
  const base = () => ({ user: oid(), items: [oid()], action: "worn" });
  const fullBinding = () => ({
    snapshotId: oid(),
    candidateId: "cand-1",
    baseKey: "topA:botB",
    fullSignature: "topA:botB|outer=none|shoes=shoeC",
  });

  it("accepts a row with all four binding fields present", async () => {
    const doc = new OutfitInteraction({ ...base(), ...fullBinding() });
    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it("accepts a legacy row with all four binding fields absent", async () => {
    const doc = new OutfitInteraction(base());
    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it("rejects a partial binding (snapshotId only)", async () => {
    const doc = new OutfitInteraction({ ...base(), snapshotId: oid() });
    await expect(doc.validate()).rejects.toThrow(/all present or all absent/);
  });

  it("rejects a partial binding (missing fullSignature)", async () => {
    const doc = new OutfitInteraction({
      ...base(),
      snapshotId: oid(),
      candidateId: "cand-1",
      baseKey: "topA:botB",
    });
    await expect(doc.validate()).rejects.toThrow(/all present or all absent/);
  });

  it("treats empty-string keys as absent (rejects snapshotId + 3 empty strings)", async () => {
    const doc = new OutfitInteraction({
      ...base(),
      snapshotId: oid(),
      candidateId: "",
      baseKey: "",
      fullSignature: "",
    });
    await expect(doc.validate()).rejects.toThrow(/all present or all absent/);
  });
});

describe("OutfitInteraction — binding index", () => {
  it("declares the deterministic user+createdAt+_id reducer-window index", () => {
    const hasIndex = OutfitInteraction.schema
      .indexes()
      .some(([keys]) => keys.user === 1 && keys.createdAt === -1 && keys._id === -1);
    expect(hasIndex).toBe(true);
  });

  it("declares the {snapshotId, candidateId} join index", () => {
    const hasIndex = OutfitInteraction.schema
      .indexes()
      .some(([keys]) => keys.snapshotId === 1 && keys.candidateId === 1);
    expect(hasIndex).toBe(true);
  });
});
