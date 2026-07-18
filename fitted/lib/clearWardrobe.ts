// Clear-wardrobe deletion logic, extracted from the route so it is unit-testable without a live
// DB (repo idiom: testable units live in lib/, cf. lib/deriveWarmth.ts). §23-H14 clear-wardrobe arm.

import { referencedImageIds, type SnapshotRefModel } from "@/lib/imageReferences";

// Minimal structural view of the collections a clear touches — a real Mongoose Model is assignable
// to it, and a stub is trivial in tests, mirroring User.ts's cascadeDeleteUserData
// dependency-injection pattern.
export type ClearableModels = {
  WardrobeItem: {
    deleteMany: (f: Record<string, unknown>) => { exec: () => Promise<{ deletedCount?: number }> };
  };
  WardrobeImage: {
    deleteMany: (f: Record<string, unknown>) => { exec: () => Promise<unknown> };
  };
  GenerationSnapshot: SnapshotRefModel;
};

/**
 * Clear a user's wardrobe: hard-delete their wardrobe items AND the image documents. Images are
 * served by id, so leaving orphans behind keeps retrievable bytes — the clear-wardrobe arm of
 * §23-H14, parallel to cascadeDeleteUserData. Interactions are intentionally NOT cleared (clearing
 * a wardrobe keeps feedback history). Returns the wardrobe-item delete count for the response.
 *
 * EXCEPTION (§D2 / lib/imageReferences): images a GenerationSnapshot still references are KEPT, so
 * the M6 image-embedding re-measure can re-fetch the pixels an accepted outfit was built from —
 * clearing a wardrobe must not silently void the image side of already-labeled outfits. Account
 * deletion still purges everything unconditionally (erasure).
 */
export async function clearUserWardrobe(models: ClearableModels, userId: unknown): Promise<number> {
  const result = await models.WardrobeItem.deleteMany({ user: userId }).exec();
  const keepIds = await referencedImageIds(models.GenerationSnapshot, userId);
  await models.WardrobeImage.deleteMany(
    keepIds.length > 0 ? { user: userId, _id: { $nin: keepIds } } : { user: userId },
  ).exec();
  return result.deletedCount ?? 0;
}
