// A GenerationSnapshot references a garment photo via `itemSnapshots.evidence.image.imageRef`
// = "mongo:<imageId>" (models/GenerationSnapshot.ts). Those refs must stay RESOLVABLE so the
// M6/H26 image-embedding re-measure can re-fetch the exact pixels an accepted outfit was built
// from: an append-only snapshot is immutable training truth, but the WardrobeImage bytes it points
// at are not, and hard-deleting a referenced image silently voids that outfit's image side —
// invisible until M6, irreversible. So item-delete and clear-wardrobe KEEP a snapshot-referenced
// image; ACCOUNT deletion still purges everything unconditionally (erasure — models/User.ts
// cascade). A kept image is owned by the same user, still served only to that owner, and still
// purged on account-delete. (Track2 stable-audit D2 / Fable#2.)

const MONGO_PREFIX = "mongo:";
const IMAGE_REF_PATH = "itemSnapshots.evidence.image.imageRef";
// A WardrobeImage _id is always a 24-hex ObjectId. `imagePath` is a free-form PATCH field, so a
// snapshot's imageRef could carry a non-hex tail ("mongo:garbage"); a non-hex id must NOT reach the
// clear-wardrobe `_id: {$nin: keepIds}` filter, where Mongoose would CastError → 500 AFTER the item
// delete already ran (a partial clear). Mirror the item-delete guard (`[id]/route.ts` OBJECT_ID_RE)
// + the export's `parseImageId` — drop non-hex tails here rather than crash downstream.
const IMAGE_ID_RE = /^[a-f0-9]{24}$/i;

type ExistsQuery = { exec: () => Promise<unknown> };
type DistinctQuery = { exec: () => Promise<unknown[]> };
export type SnapshotRefModel = {
  exists: (filter: Record<string, unknown>) => ExistsQuery;
  distinct: (field: string, filter: Record<string, unknown>) => DistinctQuery;
};

/** True if any of this user's snapshots reference `imagePath` (a "mongo:<id>" string). A non-mongo
 *  path can't be referenced (snapshots only ever store the mongo: form), so it short-circuits. */
export async function isImagePathReferenced(
  SnapshotModel: Pick<SnapshotRefModel, "exists">,
  userId: unknown,
  imagePath: string | undefined,
): Promise<boolean> {
  if (!imagePath || !imagePath.startsWith(MONGO_PREFIX)) return false;
  const hit = await SnapshotModel.exists({ user: userId, [IMAGE_REF_PATH]: imagePath }).exec();
  return hit != null;
}

/** The set of WardrobeImage `_id` strings referenced by this user's snapshots (mongo: prefix
 *  stripped) — the images a clear-wardrobe must KEEP. `distinct` traverses the itemSnapshots array. */
export async function referencedImageIds(
  SnapshotModel: Pick<SnapshotRefModel, "distinct">,
  userId: unknown,
): Promise<string[]> {
  const refs = await SnapshotModel.distinct(IMAGE_REF_PATH, { user: userId }).exec();
  const ids = new Set<string>();
  for (const r of refs) {
    if (typeof r !== "string" || !r.startsWith(MONGO_PREFIX)) continue;
    const id = r.slice(MONGO_PREFIX.length);
    // Only real 24-hex ids can name a WardrobeImage; a non-hex tail would CastError the $nin filter.
    if (IMAGE_ID_RE.test(id)) ids.add(id);
  }
  return [...ids];
}
