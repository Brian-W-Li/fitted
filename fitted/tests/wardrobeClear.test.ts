/**
 * §23-H14 (clear-wardrobe arm): clearing a wardrobe must also drop the user's image documents,
 * not just wardrobe items — images are served by id, so orphaned image bytes stay retrievable.
 *
 * No DB harness in this repo, so we exercise the extracted clearUserWardrobe helper with stub
 * models that record every deleteMany, mirroring userCascade.test.ts.
 */
import { Types } from "mongoose";
import { clearUserWardrobe } from "@/lib/clearWardrobe";

// `snapshotRefs` = the imageRefs the user's GenerationSnapshots reference (§D2 keep-set). Default []
// (no snapshots) so the legacy "delete all images" behavior is exercised unchanged.
function stubModels(snapshotRefs: string[] = []) {
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
      GenerationSnapshot: {
        exists: () => ({ exec: async () => null }),
        distinct: (_field: string, _filter: Record<string, unknown>) => ({
          exec: async () => snapshotRefs,
        }),
      },
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
      {
        WardrobeItem: model("wardrobeitems"),
        WardrobeImage: model("wardrobeimages"),
        GenerationSnapshot: {
          exists: () => ({ exec: async () => null }),
          distinct: () => ({ exec: async () => [] }),
        },
      },
      new Types.ObjectId(),
    );
    expect(deleted).toBe(0);
  });

  it("KEEPS snapshot-referenced images: excludes them from the image deleteMany (§D2)", async () => {
    const keep1 = "1".repeat(24); // realistic 24-hex WardrobeImage _ids (the guarded id shape)
    const keep2 = "2".repeat(24);
    const { calls, models } = stubModels([`mongo:${keep1}`, `mongo:${keep2}`]);
    const userId = new Types.ObjectId();

    await clearUserWardrobe(models, userId);

    // Items still fully deleted; images scoped to the user but EXCLUDING the referenced ids.
    expect(calls.wardrobeitems).toEqual([{ user: userId }]);
    expect(calls.wardrobeimages).toEqual([
      { user: userId, _id: { $nin: [keep1, keep2] } },
    ]);
  });
});
