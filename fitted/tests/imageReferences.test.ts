/**
 * §D2 (Track2 stable-audit): a GenerationSnapshot references a garment photo via
 * `itemSnapshots.evidence.image.imageRef` = "mongo:<id>". Deleting a referenced image would void
 * the image side of an already-labeled outfit for the M6 re-measure (append-only, irreversible), so
 * item-delete / clear-wardrobe must KEEP referenced images. Unit-tested with stub models (repo idiom).
 */
import { isImagePathReferenced, referencedImageIds } from "@/lib/imageReferences";

const IMAGE_REF_PATH = "itemSnapshots.evidence.image.imageRef";

function existsStub(hit: unknown) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    model: {
      exists: (filter: Record<string, unknown>) => {
        calls.push(filter);
        return { exec: async () => hit };
      },
    },
  };
}
function distinctStub(refs: unknown[]) {
  const calls: { field: string; filter: Record<string, unknown> }[] = [];
  return {
    calls,
    model: {
      distinct: (field: string, filter: Record<string, unknown>) => {
        calls.push({ field, filter });
        return { exec: async () => refs };
      },
    },
  };
}

describe("isImagePathReferenced", () => {
  it("returns true when a snapshot references the mongo: path, querying the right field", async () => {
    const { calls, model } = existsStub({ _id: "snap1" });
    const ok = await isImagePathReferenced(model, "u1", "mongo:img1");
    expect(ok).toBe(true);
    expect(calls).toEqual([{ user: "u1", [IMAGE_REF_PATH]: "mongo:img1" }]);
  });

  it("returns false when no snapshot references it (exists → null)", async () => {
    const { model } = existsStub(null);
    expect(await isImagePathReferenced(model, "u1", "mongo:img1")).toBe(false);
  });

  it("short-circuits a non-mongo or missing path without querying", async () => {
    const { calls, model } = existsStub({ _id: "x" });
    expect(await isImagePathReferenced(model, "u1", "http://x")).toBe(false);
    expect(await isImagePathReferenced(model, "u1", undefined)).toBe(false);
    expect(calls).toEqual([]); // never hit the DB
  });
});

describe("referencedImageIds", () => {
  const A = "a".repeat(24); // realistic 24-hex WardrobeImage _ids
  const B = "b".repeat(24);

  it("returns the distinct image ids with the mongo: prefix stripped", async () => {
    const { calls, model } = distinctStub([`mongo:${A}`, `mongo:${B}`]);
    const ids = await referencedImageIds(model, "u1");
    expect(ids.sort()).toEqual([A, B].sort());
    expect(calls).toEqual([{ field: IMAGE_REF_PATH, filter: { user: "u1" } }]);
  });

  it("ignores non-string / non-mongo / null refs (dangling old refs are harmless)", async () => {
    const { model } = distinctStub([`mongo:${A}`, null, "", "http://x", 42]);
    expect(await referencedImageIds(model, "u1")).toEqual([A]);
  });

  it("drops a non-hex tail so it can't CastError the clear-wardrobe $nin filter (partial-clear 500)", async () => {
    // `imagePath` is a free-form PATCH field, so a snapshot ref could be "mongo:garbage". A non-hex
    // id must never reach `WardrobeImage.deleteMany({_id:{$nin:[...]}})` (Mongoose ObjectId cast → 500
    // AFTER the item delete already ran). The guard drops it; the valid id is still kept.
    const { model } = distinctStub([`mongo:${A}`, "mongo:garbage", "mongo:short", `mongo:${B}xyz`]);
    expect((await referencedImageIds(model, "u1")).sort()).toEqual([A]);
  });

  it("returns an empty array when the user has no referencing snapshots", async () => {
    const { model } = distinctStub([]);
    expect(await referencedImageIds(model, "u1")).toEqual([]);
  });
});
