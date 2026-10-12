import { reclaimWardrobeImage, withImageConcurrency, unretainedImageFilter, type ImageRetentionModels } from "@/lib/imageRetention";

export type ClearableModels = ImageRetentionModels;

export type ClearWardrobeReceipt = {
  // Null means a failed delete may have committed, so Mongo did not return a count.
  deletedCount: number | null;
  itemsCleared: boolean | null;
  cleanupComplete: boolean;
};

export class WardrobeClearIncomplete extends Error {
  constructor(readonly receipt: ClearWardrobeReceipt, cause: unknown) {
    super("Wardrobe clear is incomplete", { cause });
  }
}

/** Delete owner garments, then sweep only settled images without active garment or snapshot pins.
 * Every retry repeats the image sweep even when no garments remain. A failed delete may still be
 * in flight after its result is lost; an empty read cannot prove completion, so defer the sweep. */
export async function clearUserWardrobe(models: ClearableModels, userId: unknown): Promise<ClearWardrobeReceipt> {
  let deletedCount: number | null = null;
  try {
    const result = await models.WardrobeItem.deleteMany(
      { user: userId }, { writeConcern: { w: "majority" } },
    ).exec();
    if (result?.acknowledged !== true || !Number.isSafeInteger(result.deletedCount) || result.deletedCount < 0) {
      throw new Error("Wardrobe delete did not return an acknowledged count");
    }
    deletedCount = result.deletedCount;
  } catch (error) {
    throw new WardrobeClearIncomplete({ deletedCount: null, itemsCleared: null, cleanupComplete: false }, error);
  }

  try {
    const imageIds = await models.WardrobeImage.distinct("_id", { user: userId, ...unretainedImageFilter }).exec();
    await withImageConcurrency(imageIds, async imageId => {
      await reclaimWardrobeImage(models, userId, String(imageId));
    });
  } catch (error) {
    throw new WardrobeClearIncomplete({ deletedCount, itemsCleared: true, cleanupComplete: false }, error);
  }
  return { deletedCount, itemsCleared: true, cleanupComplete: true };
}
