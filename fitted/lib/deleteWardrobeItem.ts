import { attachmentImageIds } from "@/lib/imageAttachments";
import { reclaimWardrobeImage, withImageConcurrency, type ImageRetentionModels } from "@/lib/imageRetention";

export type ItemDeletionReceipt = { itemDeleted: boolean | null; cleanupComplete: boolean };
export class WardrobeItemDeletionIncomplete extends Error {
  constructor(readonly receipt: ItemDeletionReceipt, cause: unknown) {
    super("Garment deletion is incomplete", { cause });
  }
}

/** An acknowledged missing row satisfies deletion too. Retry reconciles only this owner's
 * original garment photos, preserving active attachments, historic references and leases.
 * Unknown delete outcomes must not start cleanup while the mutation could still be in flight. */
export async function deleteUserWardrobeItem(models: ImageRetentionModels, user: unknown, itemId: string): Promise<ItemDeletionReceipt> {
  let captured;
  try {
    captured = await models.WardrobeItem.findOneAndDelete(
      { _id: itemId, user }, { writeConcern: { w: "majority" } },
    ).exec();
  } catch (error) {
    throw new WardrobeItemDeletionIncomplete({ itemDeleted: null, cleanupComplete: false }, error);
  }
  try {
    const scoped = await models.WardrobeImage.distinct("_id", { user, wardrobeItem: itemId }).exec();
    const images = new Set([...(captured ? attachmentImageIds(captured) : []), ...scoped.map(String)]);
    await withImageConcurrency([...images], imageId => reclaimWardrobeImage(models, user, imageId));
  } catch (error) {
    throw new WardrobeItemDeletionIncomplete({ itemDeleted: true, cleanupComplete: false }, error);
  }
  return { itemDeleted: true, cleanupComplete: true };
}
