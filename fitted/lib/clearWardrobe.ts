// Clear-wardrobe deletion logic, extracted from the route so it is unit-testable without a live
// DB (repo idiom: testable units live in lib/, cf. lib/deriveWarmth.ts). §23-H14 clear-wardrobe arm.

// Minimal structural view of the two collections a clear touches — a real Mongoose Model is
// assignable to it, and a stub is trivial in tests, mirroring User.ts's cascadeDeleteUserData
// dependency-injection pattern.
export type ClearableModels = {
  WardrobeItem: {
    deleteMany: (f: Record<string, unknown>) => { exec: () => Promise<{ deletedCount?: number }> };
  };
  WardrobeImage: {
    deleteMany: (f: Record<string, unknown>) => { exec: () => Promise<unknown> };
  };
};

/**
 * Clear a user's wardrobe: hard-delete their wardrobe items AND the image documents. Images are
 * served by id, so leaving them behind orphans retrievable bytes — the clear-wardrobe arm of
 * §23-H14, parallel to cascadeDeleteUserData. Interactions are intentionally NOT cleared (clearing
 * a wardrobe keeps feedback history). Returns the wardrobe-item delete count for the response.
 */
export async function clearUserWardrobe(models: ClearableModels, userId: unknown): Promise<number> {
  const result = await models.WardrobeItem.deleteMany({ user: userId }).exec();
  await models.WardrobeImage.deleteMany({ user: userId }).exec();
  return result.deletedCount ?? 0;
}
