import type { Model } from "mongoose";
import { isImagePathReferenced, referencedImageIds } from "@/lib/imageReferences";
import { activeAttachmentFilter } from "@/lib/imageAttachments";
export { mongoImageId, localImageId } from "@/lib/imageAttachments";

// Missing legacy fields match these predicates too. The check belongs in the destructive
// Mongo operation itself: a read followed by an unconditional delete cannot fence a writer.
export const unretainedImageFilter = {
  attachmentLease: { $exists: false },
  snapshotRetained: { $ne: true },
  "generationLeases.0": { $exists: false },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
export type ImageRetentionModels = {
  WardrobeImage: AnyModel;
  WardrobeItem: AnyModel;
  GenerationSnapshot: AnyModel;
};
/** Bound database concurrency without serializing an entire photographed closet. */
export async function withImageConcurrency<T>(values: T[], apply: (value: T) => Promise<void>) {
  for (let start = 0; start < values.length; start += 8) {
    // Wait for the full batch even on failure: finally must not race an unfinished acquisition.
    const results = await Promise.allSettled(values.slice(start, start + 8).map(apply));
    const rejected = results.find(result => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  }
}
/** Reclaim a superseded/deleted garment photo, preserving historic refs and active pins. */
export async function reclaimWardrobeImage(models: ImageRetentionModels, user: unknown, imageId: string) {
  // Establish that these bytes are settled BEFORE reading their active references. Fresh
  // uploads are born leased; settled IDs cannot be reattached by any client operation. A
  // stale no-active-ref read therefore cannot race a fresh upload's link + lease release.
  if (!(await models.WardrobeImage.exists({ _id: imageId, user, ...unretainedImageFilter }))) return;
  const path = `mongo:${imageId}`;
  if (await models.WardrobeItem.exists({ user, ...activeAttachmentFilter(imageId) })) return;
  if (await isImagePathReferenced(models.GenerationSnapshot, user, path)) return;
  await models.WardrobeImage.deleteOne({ _id: imageId, user, ...unretainedImageFilter }).exec();
}

/** Release only after reconciling durable snapshot evidence, including an ambiguous insert.
 * A failed DB check/transfer leaves the non-expiring pin intact; account erasure still purges it.
 * Promotion and removal of this invocation's pin share one atomic update. Never upsert bytes. */
export async function finishImageLeases(models: ImageRetentionModels, user: unknown, lease: string, imageIds: Set<string>, allowUnreferencedRelease = true) {
  if (imageIds.size === 0) return;
  let references: Set<string>;
  try { references = new Set(await referencedImageIds(models.GenerationSnapshot, user)); }
  catch (error) {
    console.error("Photo retention reconciliation deferred; durable leases preserved:", error);
    return;
  }
  await withImageConcurrency([...imageIds], async imageId => {
    try {
      const retained = references.has(imageId);
      if (!retained && !allowUnreferencedRelease) return;
      await models.WardrobeImage.updateOne(
        { _id: imageId, user },
        { $pull: { generationLeases: lease }, ...(retained ? { $set: { snapshotRetained: true } } : {}) },
      ).exec();
      if (!retained) await reclaimWardrobeImage(models, user, imageId);
    } catch (error) {
      console.error("Photo retention cleanup incomplete; no destructive fallback attempted:", error);
    }
  });
}
