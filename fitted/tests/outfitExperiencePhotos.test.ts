import { randomUUID } from "crypto";
import { Types } from "mongoose";
import User, { cascadeDeleteUserData } from "@/models/User";
import { beginUserErasure } from "@/lib/userErasure";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { getExperience } from "@/lib/outfitExperience/read";
import { reclaimWardrobeImage, unretainedImageFilter } from "@/lib/imageRetention";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture, gate } from "./helpers/experienceFixture";
let harness: MongoHarness;
const now = () => new Date("2026-10-10T12:00:00Z");
const models = { WardrobeItem, WardrobeImage, GenerationSnapshot };
beforeAll(async () => { harness = await startMemoryMongo([User, WardrobeItem, WardrobeImage, GenerationSnapshot, OutfitExperience], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness.clear(); });
afterAll(async () => { await harness.stop(); });
async function photo(owner: string, itemId: string) {
  return String((await WardrobeImage.create({ user: owner, wardrobeItem: itemId, base64: "AQID", contentType: "image/png", sizeBytes: 3 }))._id);
}
async function fixture() {
  const f = await experienceFixture();
  const bottom = String((await WardrobeItem.create({ user: f.owner, name: "Actual skirt", clothingType: "bottom", category: "bottom", warmth: 4 }))._id);
  const sourceImage = await photo(f.owner, f.itemId); const addedImage = await photo(f.owner, bottom);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "itemSnapshots.0.engineVisible.imageUrl": `mongo:${sourceImage}` } });
  await WardrobeItem.updateOne({ _id: bottom }, { $set: { imagePath: `mongo:${addedImage}` } });
  return { ...f, bottom, sourceImage, addedImage, input: { ...f.input, compositionStatus: "changed", memberItemIds: [f.itemId, bottom] } };
}
async function detach(owner: string, item: string, image: string) {
  await WardrobeItem.updateOne({ _id: item, user: owner }, { $unset: { imagePath: 1 } });
  await reclaimWardrobeImage(models, new Types.ObjectId(owner), image);
}
it("captures actual member photos and holds exact bytes after wardrobe/source removal", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  const saved = await experienceCollection().findOne({ user: new Types.ObjectId(f.owner), experienceId: f.input.experienceId });
  expect(saved!.revisions![0].state.memberItems).toMatchObject([
    { photo: { imageRef: `mongo:${f.sourceImage}`, origin: "suggestion", capturedAt: now().toISOString() } },
    { photo: { imageRef: `mongo:${f.addedImage}`, origin: "wardrobe", capturedAt: now().toISOString() } },
  ]);
  await detach(f.owner, f.bottom, f.addedImage);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  expect((await getExperience(f.owner, f.input.experienceId)).items!.map(i => i.imageUrl)).toEqual([`mongo:${f.sourceImage}`, `mongo:${f.addedImage}`]);
});
it("records explicit missing evidence when photo removal wins before admission", async () => {
  const f = await fixture();
  const store = new ExperienceStore({ now, beforeWrite: async type => { if (type === "create") await detach(f.owner, f.bottom, f.addedImage); } });
  await store.create(f.owner, f.input);
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![0].state.memberItems![1]).toHaveProperty("photo", null);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).toBeNull();
});
it("preserves photos through ordinary correction/retraction and releases all report holds on erasure", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input); await detach(f.owner, f.bottom, f.addedImage);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
  await store.revise(f.owner, f.input.experienceId, { ...f.state, compositionStatus: "changed", memberItemIds: f.input.memberItemIds, operationId: randomUUID(), expectedPreviousRevision: 1, outcome: "worked" });
  await store.retract(f.owner, f.input.experienceId, { operationId: randomUUID(), expectedPreviousRevision: 2 });
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
  await store.erase(f.owner, f.input.experienceId);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).toBeNull();
  expect(await WardrobeImage.exists({ _id: f.sourceImage })).not.toBeNull(); // separate snapshot still references it
  expect(await experienceCollection().findOne({ experienceId: f.input.experienceId })).toEqual(expect.objectContaining({ lifecycle: "erased" }));
});
it("rolls back a losing photo refresh with its revision CAS", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now }); await store.create(f.owner, f.input);
  const firstImage = await photo(f.owner, f.bottom); const winnerImage = await photo(f.owner, f.bottom);
  await WardrobeItem.updateOne({ _id: f.bottom }, { $set: { imagePath: `mongo:${firstImage}` } });
  const pause = gate();
  const delayed = new ExperienceStore({ now, beforeWrite: async type => { if (type === "revise") await pause.block(); } });
  const edit = { ...f.state, compositionStatus: "changed", memberItemIds: f.input.memberItemIds, operationId: randomUUID(), expectedPreviousRevision: 1, photoRefreshItemIds: [f.bottom] };
  const first = delayed.revise(f.owner, f.input.experienceId, edit);
  const firstResult = first.then(value => ({ value }), error => ({ error }));
  try {
    await Promise.race([pause.entered, first.then(() => { throw new Error("Expected parked correction"); })]);
    await WardrobeItem.updateOne({ _id: f.bottom }, { $set: { imagePath: `mongo:${winnerImage}` } });
    await store.revise(f.owner, f.input.experienceId, { ...edit, operationId: randomUUID() });
  } finally { pause.release(); }
  expect(await firstResult).toMatchObject({ error: { code: "revision_conflict" } });
  expect((await WardrobeImage.findById(firstImage))!.get("wearReferences") ?? []).toEqual([]);
  expect((await WardrobeImage.findById(winnerImage))!.get("wearReferences")).toContain(f.input.experienceId);
});

it("keeps retained garment facts and photo when another member is added after closet edits", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now }); await store.create(f.owner, f.input);
  const outer = String((await WardrobeItem.create({ user: f.owner, name: "Jacket", clothingType: "outer_layer", category: "outer_layer", warmth: 5 }))._id);
  await WardrobeItem.updateOne({ _id: f.bottom }, { $set: { name: "Renamed now", clothingType: "outer_layer" } });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, compositionStatus: "changed", memberItemIds: [...f.input.memberItemIds, outer], operationId: randomUUID(), expectedPreviousRevision: 1 });
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![1].state.memberItems![1]).toMatchObject({ name: "Actual skirt", clothingType: "bottom", photo: { imageRef: `mongo:${f.addedImage}` } });
});
it("keeps retained facts and photos when correcting changed wear back to the shown composition", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now });
  await WardrobeItem.updateOne({ _id: f.itemId }, { $set: { name: "Reported shirt" } });
  await store.create(f.owner, f.input);
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 });
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![1].state.memberItems![0]).toMatchObject({ name: "Reported shirt", clothingType: "top", photo: { imageRef: `mongo:${f.sourceImage}` } });
});
it("refreshes only the photo while preserving captured name/type and older revision bytes", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now }); await store.create(f.owner, f.input);
  const nextImage = await photo(f.owner, f.bottom);
  await WardrobeItem.updateOne({ _id: f.bottom }, { $set: { name: "Renamed now", clothingType: "dress", imagePath: `mongo:${nextImage}` } });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, compositionStatus: "changed", memberItemIds: f.input.memberItemIds, operationId: randomUUID(), expectedPreviousRevision: 1, photoRefreshItemIds: [f.bottom] });
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![1].state.memberItems![1]).toMatchObject({ name: "Actual skirt", clothingType: "bottom", photo: { imageRef: `mongo:${nextImage}` } });
  expect(saved!.revisions![0].state.memberItems![1].photo!.imageRef).toBe(`mongo:${f.addedImage}`);
  await reclaimWardrobeImage(models, new Types.ObjectId(f.owner), f.addedImage);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
});

it("photo pin survives concurrent conditional reclamation before report commit", async () => {
  const f = await fixture(); const pause = gate();
  const update = WardrobeImage.collection.updateOne.bind(WardrobeImage.collection);
  const pinSpy = jest.spyOn(WardrobeImage.collection, "updateOne").mockImplementation((filter, change, options) => (async () => {
    const result = await update(filter, change, options);
    if (String(filter._id) === f.addedImage && options?.session) await pause.block();
    return result;
  })());
  const creating = new ExperienceStore({ now, beforeWrite: async () => {
    // Prepare the capture first, then remove the live attachment before pinning it.
    await WardrobeItem.updateOne({ _id: f.bottom }, { $unset: { imagePath: 1 } });
  } }).create(f.owner, f.input);
  try {
    await Promise.race([pause.entered, creating.then(() => { throw new Error("Expected parked pin"); })]);
    // Start the conditional destructive write while the transaction holds the image.
    // Waiting for reclamation here would deadlock: Mongo waits for the pin transaction.
    const removing = WardrobeImage.collection.deleteOne({
      _id: new Types.ObjectId(f.addedImage), user: new Types.ObjectId(f.owner), ...unretainedImageFilter,
    });
    pause.release();
    const [, deleted] = await Promise.all([creating, removing]);
    expect(deleted.deletedCount).toBe(0);
    expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
    expect((await getExperience(f.owner, f.input.experienceId)).items![1].imageUrl).toBe(`mongo:${f.addedImage}`);
  } finally {
    pause.release();
    await creating.catch(() => undefined);
    pinSpy.mockRestore();
  }
});
it("keeps shared photo bytes until the final wear hold is erased", async () => {
  const f = await fixture(); const store = new ExperienceStore({ now });
  const second = { ...f.input, experienceId: randomUUID(), operationId: randomUUID() };
  await store.create(f.owner, f.input); await store.create(f.owner, second);
  await detach(f.owner, f.bottom, f.addedImage);
  await store.erase(f.owner, f.input.experienceId);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull();
  expect((await getExperience(f.owner, second.experienceId)).items![1].imageUrl).toBe(`mongo:${f.addedImage}`);
  await store.erase(f.owner, second.experienceId);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).toBeNull();
});
it("retries committed report/erase acknowledgments without changing captures or restoring content", async () => {
  const f = await fixture(); let loseCreate = true; let loseErase = true;
  const store = new ExperienceStore({ now, afterNativeWrite: async type => {
    if (type === "create" && loseCreate) { loseCreate = false; throw new Error("lost create acknowledgment"); }
    if (type === "erase" && loseErase) { loseErase = false; throw new Error("lost erase acknowledgment"); }
  } });
  await expect(store.create(f.owner, f.input)).rejects.toThrow("lost create");
  const laterImage = await photo(f.owner, f.bottom);
  await WardrobeItem.updateOne({ _id: f.bottom }, { $set: { imagePath: `mongo:${laterImage}` } });
  await store.create(f.owner, f.input);
  expect((await getExperience(f.owner, f.input.experienceId)).items![1].imageUrl).toBe(`mongo:${f.addedImage}`);
  expect((await WardrobeImage.findById(laterImage))!.get("wearReferences") ?? []).toEqual([]);
  await expect(store.erase(f.owner, f.input.experienceId)).rejects.toThrow("lost erase");
  const marker = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(Object.keys(marker!).sort()).toEqual(["_id", "experienceId", "lifecycle", "user"]);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).not.toBeNull(); // cleanup not yet acknowledged
  await store.erase(f.owner, f.input.experienceId);
  expect(await WardrobeImage.exists({ _id: f.addedImage })).toBeNull();
  expect(await WardrobeImage.exists({ _id: laterImage })).not.toBeNull(); // still current wardrobe photo
});
it("account erasure wins delayed capture and purges holds without affecting another owner", async () => {
  const f = await fixture(); const other = await fixture(); const pause = gate();
  const store = new ExperienceStore({ now, beforeWrite: async type => { if (type === "create") await pause.block(); } });
  const creating = store.create(f.owner, f.input);
  const result = creating.then(value => ({ value }), error => ({ error }));
  try {
    await pause.entered;
    await beginUserErasure(User, f.owner);
    await cascadeDeleteUserData(User.db, f.owner);
  } finally { pause.release(); }
  expect(await result).toMatchObject({ error: { code: "account_unavailable" } });
  expect(await WardrobeImage.countDocuments({ user: f.owner })).toBe(0);
  expect(await OutfitExperience.countDocuments({ user: f.owner })).toBe(0);
  expect(await WardrobeImage.countDocuments({ user: other.owner })).toBe(2);
});
it("captures additions from current wardrobe primary, rejects foreign pixels and refresh misuse", async () => {
  const f = await fixture(); const other = await fixture();
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "itemSnapshots.1": {
    itemId: f.bottom, engineVisible: { name: "Skirt", clothingType: "bottom", imageUrl: `mongo:${other.addedImage}` },
  } } }); // sampled but not part of the source candidate
  const store = new ExperienceStore({ now }); await store.create(f.owner, f.input);
  expect((await getExperience(f.owner, f.input.experienceId)).items![1].imageUrl).toBe(`mongo:${f.addedImage}`);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "itemSnapshots.0.engineVisible.imageUrl": `mongo:${other.sourceImage}` } });
  const second = { ...f.input, experienceId: randomUUID(), operationId: randomUUID() };
  await store.create(f.owner, second);
  expect((await getExperience(f.owner, second.experienceId)).items![0].imageUrl).toBeNull();
  expect((await WardrobeImage.findById(other.sourceImage))!.get("wearReferences") ?? []).toEqual([]);
  const edit = { ...f.state, compositionStatus: "changed", memberItemIds: f.input.memberItemIds, expectedPreviousRevision: 1, operationId: randomUUID() };
  await expect(store.revise(f.owner, f.input.experienceId, { ...edit, photoRefreshItemIds: [f.bottom, f.bottom] })).rejects.toThrow();
  await expect(store.revise(f.owner, f.input.experienceId, { ...edit, photoRefreshItemIds: [other.bottom] })).rejects.toThrow();
  await expect(store.create(f.owner, { ...second, photoRefreshItemIds: [f.bottom] })).rejects.toThrow();
  await WardrobeItem.deleteOne({ _id: f.bottom });
  await expect(store.revise(f.owner, f.input.experienceId, { ...edit, photoRefreshItemIds: [f.bottom] })).rejects.toThrow();
});
