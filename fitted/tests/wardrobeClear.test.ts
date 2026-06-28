/**
 * §23-H14 (clear-wardrobe arm): clearing a wardrobe must also drop the user's image documents,
 * not just wardrobe items — images are served by id, so orphaned image bytes stay retrievable.
 *
 * No DB harness in this repo, so we exercise the extracted clearUserWardrobe helper with stub
 * models that record every deleteMany, mirroring userCascade.test.ts.
 */
import { Types } from "mongoose";
import { clearUserWardrobe } from "@/lib/clearWardrobe";

function stubModels() {
  const calls: Record<string, Record<string, unknown>[]> = {};
  const model = (name: string, deletedCount?: number) => ({
    deleteMany: (filter: Record<string, unknown>) => {
      (calls[name] ||= []).push(filter);
      return { exec: async () => ({ deletedCount }) };
    },
  });
  return {
    calls,
    models: {
      WardrobeItem: model("wardrobeitems", 3),
      WardrobeImage: model("wardrobeimages"),
    },
  };
}

describe("clearUserWardrobe", () => {
  it("deletes wardrobeitems AND wardrobeimages scoped to the user (the H14 clear arm)", async () => {
    const { calls, models } = stubModels();
    const userId = new Types.ObjectId();

    const deleted = await clearUserWardrobe(models, userId);

    expect(calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(calls.wardrobeimages).toEqual([{ user: userId }]); // previously missing — orphaned images
    expect(deleted).toBe(3);
  });

  it("does NOT touch interactions (clearing a wardrobe keeps feedback history)", async () => {
    const { calls, models } = stubModels();
    await clearUserWardrobe(models, new Types.ObjectId());
    expect(calls.outfitinteractions).toBeUndefined();
  });

  it("coalesces a missing deletedCount to 0", async () => {
    const calls: Record<string, Record<string, unknown>[]> = {};
    const model = (name: string) => ({
      deleteMany: (filter: Record<string, unknown>) => {
        (calls[name] ||= []).push(filter);
        return { exec: async () => ({}) }; // no deletedCount
      },
    });
    const deleted = await clearUserWardrobe(
      { WardrobeItem: model("wardrobeitems"), WardrobeImage: model("wardrobeimages") },
      new Types.ObjectId(),
    );
    expect(deleted).toBe(0);
  });
});
