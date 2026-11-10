import { Types, type ClientSession } from "mongoose";
import WardrobeImage from "@/models/WardrobeImage";
import WardrobeItem from "@/models/WardrobeItem";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { localImageId, primaryImageRef, type RawAttachments } from "@/lib/imageAttachments";
import { reclaimWardrobeImage, unretainedImageFilter, withImageConcurrency } from "@/lib/imageRetention";
import { ExperienceValidationError } from "./errors";
import type { ActualItem } from "./contract";
import type { MemorySnapshot } from "./source";

export interface WearPhotoPlan { items: ActualItem[]; captureIds: Set<string> }

/** Select immutable photo identities before the write. Preserve prior captures, including
 * explicit missing/legacy evidence, unless the user requested a refresh. No byte copies. */
export async function planWearPhotos(user: Types.ObjectId, members: ActualItem[], capturedAt: string,
  source?: { snapshot: MemorySnapshot; candidateId: string }, previous: ActualItem[] = [], refreshIds: string[] = []): Promise<WearPhotoPlan> {
  const prior = new Map(previous.map(item => [item.itemId, item]));
  const finalIds = new Set(members.map(item => item.itemId));
  if (refreshIds.some(id => !finalIds.has(id) || !prior.has(id))) {
    throw new ExperienceValidationError("request", "Refresh only a retained reported piece");
  }
  const refresh = new Set(refreshIds);
  const captureIds = new Set(members.filter(item => !prior.has(item.itemId) || refresh.has(item.itemId)).map(item => item.itemId));
  const wardrobe = captureIds.size ? await WardrobeItem.collection.find({ user, _id: { $in: [...captureIds].map(id => new Types.ObjectId(id)) } },
    { projection: { imagePath: 1, imageUrl: 1 } }).toArray() : [];
  const current = new Map<string, RawAttachments>(wardrobe.map(item => [String(item._id), { imagePath: item.imagePath, imageUrl: item.imageUrl }]));
  const suggestedIds = new Set(source?.snapshot.candidates.find(candidate => candidate.candidateId === source.candidateId)?.items.map(item => item.itemId) ?? []);
  if (refreshIds.some(id => !current.has(id))) throw new ExperienceValidationError("request", "A refreshed piece must still belong to your closet");
  return { captureIds, items: members.map(item => {
    if (!captureIds.has(item.itemId)) return { ...item, ...(prior.get(item.itemId)?.photo === undefined
      ? {} : { photo: prior.get(item.itemId)!.photo }) };
    const suggested = !refresh.has(item.itemId) && suggestedIds.has(item.itemId) ? localImageId(source?.snapshot.itemSnapshots.find(row => row.itemId === item.itemId)?.engineVisible?.imageUrl) : undefined;
    const currentId = localImageId(primaryImageRef(current.get(item.itemId) ?? {}));
    const id = suggested ?? currentId;
    return { ...item, photo: id ? { imageRef: `mongo:${id.toLowerCase()}`, origin: suggested ? "suggestion" as const : "wardrobe" as const, capturedAt } : null };
  }) };
}

/** Pin and report writes share one transaction. Clone per callback retry: an aborted
 * attempt must not mutate the prepared capture. Missing/foreign/other-garment bytes
 * become explicit missing evidence, never a dangling or borrowed photo reference. */
export async function pinWearPhotos(user: Types.ObjectId, experienceId: string, plan: WearPhotoPlan, session: ClientSession): Promise<ActualItem[]> {
  const items = plan.items.map(item => ({ ...item }));
  for (const item of items) {
    if (!plan.captureIds.has(item.itemId) || !item.photo) continue;
    const imageId = localImageId(item.photo.imageRef)!;
    const held = await WardrobeImage.collection.updateOne({ _id: new Types.ObjectId(imageId), user, wardrobeItem: new Types.ObjectId(item.itemId) },
      { $addToSet: { wearReferences: experienceId } }, { session });
    if (!held.matchedCount) item.photo = null;
  }
  return items;
}

export async function releaseWearPhotos(user: Types.ObjectId, experienceId: string, session: ClientSession): Promise<void> {
  await WardrobeImage.updateMany({ user, wearReferences: experienceId }, { $pull: { wearReferences: experienceId } }, { session }).exec();
}

/** Marker retries have no old content from which to recover image IDs. Sweep settled
 * owner photos after confirmed erasure; the shared reclaimer protects every live use.
 * An error propagates so the caller can retry cleanup without restoring report content. */
export async function reclaimAfterWearErasure(user: Types.ObjectId): Promise<void> {
  const ids = await WardrobeImage.distinct("_id", { user, ...unretainedImageFilter }).exec();
  await withImageConcurrency(ids, id => reclaimWardrobeImage({ WardrobeImage, WardrobeItem, GenerationSnapshot }, user, String(id)));
}
