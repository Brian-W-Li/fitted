import { randomUUID } from "crypto";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { createInput } from "@/lib/outfitExperience/contract";
import { ExperienceValidationError } from "@/lib/outfitExperience/errors";
import { getExperience, getSuggestion, recallExperiences } from "@/lib/outfitExperience/read";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture } from "./helpers/experienceFixture";

let harness: MongoHarness | undefined;
const now = () => new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { harness = await startMemoryMongo([OutfitExperience, User], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness?.clear(); });
afterAll(async () => { await harness?.stop(); });

async function wardrobe(owner: string) {
  const user = new Types.ObjectId(owner);
  const make = async (name: string, clothingType: string, layerRole?: string) => String((await WardrobeItem.create({
    user, name, clothingType, category: clothingType, warmth: 4, colors: ["grey"], ...(layerRole ? { layerRole } : {}),
  }))._id);
  return {
    bottom: await make("Trousers", "bottom"), mid: await make("Quarter zip", "top", "mid"),
    secondMid: await make("Crewneck", "top", "mid"), secondBase: await make("White tee", "top", "base"),
    outer: await make("Jacket", "outer_layer", "outer"), shoes: await make("Shoes", "shoes"), dress: await make("Dress", "dress"),
  };
}
function changed(input: Record<string, unknown>, memberItemIds: string[]) {
  return { ...input, compositionStatus: "changed", memberItemIds };
}

it("captures a changed base plus eligible mid, including optional jacket and shoes, and corrects only current recall", async () => {
  const f = await experienceFixture(); const w = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const members = [f.itemId, w.mid, w.bottom, w.outer, w.shoes];
  await WardrobeItem.updateOne({ _id: w.mid }, { $set: { isAvailable: false } });
  await store.create(f.owner, changed(f.input, members));
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![0].state.memberItems).toMatchObject([
    { itemId: f.itemId, role: "base_top" }, { itemId: w.mid, clothingType: "top", role: "mid_layer" },
    { itemId: w.bottom }, { itemId: w.outer }, { itemId: w.shoes },
  ]);
  expect((await getExperience(f.owner, f.input.experienceId)).items).toMatchObject([
    { role: "base_top" }, { role: "mid_layer", availability: "unavailable" }, {}, {}, {},
  ]);
  expect((await recallExperiences(f.owner, { itemId: w.mid })).experiences).toHaveLength(1);
  await store.revise(f.owner, f.input.experienceId, changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 }, [f.itemId, w.bottom]));
  expect((await recallExperiences(f.owner, { itemId: w.mid })).experiences).toEqual([]);
  const corrected = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(corrected!.revisions![0].state.memberItems![1].role).toBe("mid_layer");
  expect(corrected!.revisions![1].state.memberItems!.every(item => item.role === undefined)).toBe(true);
});

it("accepts an eligible mid as the sole top without relabeling that unlayered outfit", async () => {
  const f = await experienceFixture(); const w = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId, "candidates.candidateId": "c0" }, {
    $set: { "candidates.$.items": [{ itemId: f.itemId }, { itemId: w.bottom }] },
  });
  await store.create(f.owner, changed(f.input, [w.mid, w.bottom]));
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.revisions![0].state.memberItems).toEqual([
    { itemId: w.mid, name: "Quarter zip", clothingType: "top" }, { itemId: w.bottom, name: "Trousers", clothingType: "bottom" },
  ]);
});

it("reloads shown layered roles and retains captured wear roles through eligibility edits and source removal", async () => {
  const f = await experienceFixture(); const w = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const members = [f.itemId, w.mid, w.bottom, w.shoes];
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId, "candidates.candidateId": "c0" }, {
    $set: { "candidates.$.items": members.map((itemId, i) => ({ itemId, role: ["base_top", "mid_layer", "base_bottom", "shoes"][i] })) },
    $push: { itemSnapshots: { $each: [
      { itemId: w.mid, engineVisible: { name: "Quarter zip", clothingType: "top", layerRole: "mid" } },
      { itemId: w.bottom, engineVisible: { name: "Trousers", clothingType: "bottom" } },
      { itemId: w.shoes, engineVisible: { name: "Shoes", clothingType: "shoes" } },
    ] } } as never,
  });
  const sourceBefore = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates;
  expect((await getSuggestion(f.owner, String(f.snapshotId), "c0")).items).toMatchObject([
    { role: "base_top" }, { role: "mid_layer" }, {}, {},
  ]);
  await store.create(f.owner, f.input);
  await WardrobeItem.updateOne({ _id: w.mid }, { $set: { layerRole: "base" } });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1, outcome: "worked" });
  expect((await getExperience(f.owner, f.input.experienceId)).items![1]).toMatchObject({ role: "mid_layer" });
  expect((await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates).toEqual(sourceBefore);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  await WardrobeItem.deleteOne({ _id: w.mid });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 2, outcome: "worked" });
  expect((await getExperience(f.owner, f.input.experienceId)).items![1]).toMatchObject({ name: "Quarter zip", role: "mid_layer", availability: "missing" });
});

it("rejects unsupported top stacks, dress layering, repeated IDs and foreign actual members", async () => {
  const f = await experienceFixture(); const w = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const other = await User.create({ authProvider: "firebase", authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const foreignMid = await WardrobeItem.create({ user: other._id, name: "Other knit", clothingType: "top", layerRole: "mid", category: "top", warmth: 4, colors: ["black"] });
  const bad = [
    [f.itemId, w.secondBase, w.bottom], [f.itemId, w.mid, w.secondMid, w.bottom],
    [w.mid, w.secondMid, w.bottom, f.itemId], [f.itemId, w.mid, w.dress],
    [f.itemId, w.mid, w.mid, w.bottom], [f.itemId, String(foreignMid._id), w.bottom],
  ];
  for (const members of bad) await expect(store.create(f.owner, changed({ ...f.input,
    experienceId: randomUUID(), operationId: randomUUID() }, members))).rejects.toBeInstanceOf(ExperienceValidationError);
  // Keep a shown piece while testing exactly two mid-marked tops, without a third top.
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId, "candidates.candidateId": "c0" }, { $set: { "candidates.$.items": [{ itemId: w.bottom }] } });
  await expect(store.create(f.owner, changed(f.input, [w.mid, w.secondMid, w.bottom]))).rejects.toThrow("base top");
  expect(await experienceCollection().countDocuments()).toBe(0);
});

it("bounds actual membership at five IDs and keeps old shown records free of inferred roles", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  const five = Array.from({ length: 5 }, () => String(new Types.ObjectId()));
  expect(createInput(changed(f.input, five), now()).memberItemIds).toHaveLength(5);
  expect(() => createInput(changed(f.input, [...five, String(new Types.ObjectId())]), now())).toThrow("1–5");
  await store.create(f.owner, f.input);
  await WardrobeItem.updateOne({ _id: f.itemId }, { $set: { layerRole: "mid" } });
  const view = await getExperience(f.owner, f.input.experienceId);
  expect(view.items!.every(item => !("role" in item))).toBe(true);
});
