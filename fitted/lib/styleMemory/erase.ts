import { Types } from "mongoose";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { ownerWriteFence } from "@/lib/ownerWriteFence";
import { reclaimWardrobeImage, unretainedImageFilter } from "@/lib/imageRetention";
import { localImageId, mongoImageId } from "@/lib/imageAttachments";
import type { StyleMemoryData } from "./contract";

/** Idempotent, bounded cleanup after the durable tombstone already denies every source read.
 * Native deletion is the sanctioned erasure path; independent wear records/holds are untouched.
 * No deleted content is copied into a cleanup ledger. */
export async function cleanupStyleMemoryErasure(ownerId: string | Types.ObjectId): Promise<void> {
  const user = new Types.ObjectId(String(ownerId));
  const db = User.db;
  const owner = await User.collection.findOne({ _id: user, erasureStarted: { $ne: true } }, { projection: { styleMemory: 1 } });
  if (!owner) return;
  const tombstones = (owner.styleMemory as StyleMemoryData | undefined)?.tombstones ?? [];
  if (!tombstones.length) return;
  const clauses = tombstones.flatMap<Record<string, unknown>>(t => t.kind === "board" ? [
    { "styleContext.boardId": t.id }, { "styleContext.profileId": t.profileId }, { "lens.styleProfileId": new Types.ObjectId(t.profileId!) },
  ] : [{ "styleContext.routineId": t.id }, { routineId: new Types.ObjectId(t.id) }]);
  // Repeat against live owned rows: interrupted cleanup can be resumed without retaining payloads.
  while (true) {
    const reclaimed = new Set<string>();
    const count = await ownerWriteFence(User, user, async session => {
      const rows = await GenerationSnapshot.collection.find({ user, $or: clauses }, { session, limit: 100 }).toArray();
      if (!rows.length) return 0;
      const ids = rows.map(row => row._id), leases = ids.map(String);
      for (const row of rows) for (const item of row.itemSnapshots ?? []) {
        for (const ref of [item.evidence?.image?.imageRef, item.engineVisible?.imageUrl]) {
          const id = mongoImageId(ref) ?? localImageId(ref); if (id) reclaimed.add(id);
        }
      }
      await db.collection("outfitinteractions").deleteMany({ user, snapshotId: { $in: ids } }, { session });
      await GenerationSnapshot.collection.deleteMany({ user, _id: { $in: ids } }, { session });
      for (const imageId of reclaimed) {
        const ref = `mongo:${imageId}`;
        const remaining = await GenerationSnapshot.collection.findOne({ user, $or: [
          { "itemSnapshots.evidence.image.imageRef": ref }, { "itemSnapshots.engineVisible.imageUrl": { $in: [ref, `/api/images/${imageId}`] } },
        ] }, { session, projection: { _id: 1 } });
        await WardrobeImage.updateOne({ _id: new Types.ObjectId(imageId), user }, {
          $pull: { generationLeases: { $in: leases } }, ...(remaining ? {} : { $unset: { snapshotRetained: "" } }),
        }, { session }).exec();
      }
      return rows.length;
    });
    for (const id of reclaimed) await reclaimWardrobeImage({ WardrobeImage, WardrobeItem, GenerationSnapshot }, user, id);
    if (!count) break;
  }
  // Resume reclamation after interruption between flag release and byte cleanup.
  const settled = await WardrobeImage.find({ user, ...unretainedImageFilter }).select({ _id: 1 }).lean();
  for (const image of settled) await reclaimWardrobeImage({ WardrobeImage, WardrobeItem, GenerationSnapshot }, user, String(image._id));
}
