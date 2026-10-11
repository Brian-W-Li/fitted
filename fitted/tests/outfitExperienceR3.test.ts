import { randomUUID } from "crypto";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { ExperienceValidationError } from "@/lib/outfitExperience/errors";
import { getExperience, recallExperiences } from "@/lib/outfitExperience/read";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture, gate } from "./helpers/experienceFixture";

let harness: MongoHarness | undefined;
const now = () => new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { harness = await startMemoryMongo([OutfitExperience, User], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness?.clear(); });
afterAll(async () => { await harness?.stop(); });

async function wardrobe(owner: string) {
  const user = new Types.ObjectId(owner);
  const bottom = await WardrobeItem.create({ user, name: "Dark trousers", clothingType: "bottom", category: "bottom", warmth: 4, colors: ["black"] });
  const shoes = await WardrobeItem.create({ user, name: "Leather shoes", clothingType: "shoes", category: "shoes", warmth: 3, colors: ["brown"] });
  const outer = await WardrobeItem.create({ user, name: "Light jacket", clothingType: "outer_layer", category: "outerwear", warmth: 5, colors: ["navy"] });
  const dress = await WardrobeItem.create({ user, name: "Blue dress", clothingType: "dress", category: "dress", warmth: 4, colors: ["blue"] });
  return { bottom: String(bottom._id), shoes: String(shoes._id), outer: String(outer._id), dress: String(dress._id) };
}

function changed(input: Record<string, unknown>, memberItemIds: string[]) {
  return { ...input, compositionStatus: "changed", memberItemIds };
}

it("records a changed top-and-bottom outfit while keeping the shown source intact", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const originalSource = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates;
  await store.create(f.owner, changed(f.input, [f.itemId, items.bottom, items.shoes]));

  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.memberItemIds!.map(String).sort()).toEqual([f.itemId, items.bottom, items.shoes].sort());
  expect(saved!.revisions![0].state.compositionStatus).toBe("changed");
  expect(await recallExperiences(f.owner, { itemId: items.bottom })).toMatchObject({ experiences: [{ experienceId: f.input.experienceId }] });
  const view = await getExperience(f.owner, f.input.experienceId);
  expect(view).toMatchObject({ source: { candidateId: "c0" } });
  expect(view.items?.map(item => item.itemId)).toEqual([f.itemId, items.bottom, items.shoes]);
  expect((await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates).toEqual(originalSource);
});

it("accepts a dress composition and rejects malformed or unowned changed memberships", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  // Start with a valid shown top-and-bottom look, then retain its shoes with a dress instead.
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId, "candidates.candidateId": "c0" }, {
    $set: { "candidates.$.items": [{ itemId: f.itemId }, { itemId: items.bottom }, { itemId: items.shoes }] },
    $push: { itemSnapshots: { $each: [
      { itemId: items.bottom, engineVisible: { name: "Dark trousers", clothingType: "bottom" } },
      { itemId: items.shoes, engineVisible: { name: "Leather shoes", clothingType: "shoes" } },
    ] } } as never,
  });
  const originalSource = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates;
  await store.create(f.owner, changed(f.input, [items.dress, items.shoes]));
  const bad = [
    [],
    [f.itemId, f.itemId],
    [String(new Types.ObjectId())],
    [items.dress, items.bottom], // a dress cannot be combined with separates
    [f.itemId, items.shoes], // no bottom or dress base
  ];
  for (const memberItemIds of bad) {
    const input = { ...changed(f.input, memberItemIds), experienceId: randomUUID(), operationId: randomUUID() };
    await expect(store.create(f.owner, input)).rejects.toBeInstanceOf(ExperienceValidationError);
  }
  const other = await User.create({ authProvider: "firebase", authId: randomUUID(), email: `${randomUUID()}@example.test` });
  const foreign = await WardrobeItem.create({ user: other._id, name: "Other shoes", clothingType: "shoes",
    category: "shoes", warmth: 3, colors: ["black"] });
  await expect(store.create(f.owner, changed({ ...f.input, experienceId: randomUUID(), operationId: randomUUID() },
    [f.itemId, items.bottom, String(foreign._id)]))).rejects.toBeInstanceOf(ExperienceValidationError);
  expect(await experienceCollection().countDocuments()).toBe(1);
  expect((await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates).toEqual(originalSource);
});

it("revises actual membership with CAS, retries safely, and recalls only the latest items", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const originalSource = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates;
  await store.create(f.owner, changed(f.input, [f.itemId, items.bottom]));
  const edit = changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 }, [f.itemId, items.bottom, items.shoes]);
  const ack = await store.revise(f.owner, f.input.experienceId, edit);
  expect(ack).toMatchObject({ acknowledgedRevision: 2, currentRevision: 2 });
  expect(await store.revise(f.owner, f.input.experienceId, edit)).toMatchObject({ acknowledgedRevision: 2, currentRevision: 2 });
  expect((await recallExperiences(f.owner, { itemId: items.bottom })).experiences).toHaveLength(1);
  expect((await recallExperiences(f.owner, { itemId: items.shoes })).experiences).toHaveLength(1);
  await expect(store.revise(f.owner, f.input.experienceId, { ...edit, memberItemIds: [f.itemId, items.bottom] }))
    .rejects.toMatchObject({ code: "operation_conflict" });
  const saved = await experienceCollection().findOne({ experienceId: f.input.experienceId });
  expect(saved!.memberItemIds!.map(String).sort()).toEqual([f.itemId, items.bottom, items.shoes].sort());
  expect(saved!.revisions![0].state.compositionStatus).toBe("changed");
  expect((await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!.candidates).toEqual(originalSource);
});

it("removes an unworn garment from recall and preserves a reported substitute after closet or source changes", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  await store.create(f.owner, changed(f.input, [f.itemId, items.bottom]));
  expect((await recallExperiences(f.owner, { itemId: items.bottom })).experiences).toHaveLength(1);
  const replacement = await WardrobeItem.create({ user: new Types.ObjectId(f.owner), name: "Grey trousers",
    clothingType: "bottom", category: "bottom", warmth: 4, colors: ["grey"], isAvailable: false });
  const replacementId = String(replacement._id);
  await store.revise(f.owner, f.input.experienceId, changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 }, [f.itemId, replacementId]));
  expect((await recallExperiences(f.owner, { itemId: items.bottom })).experiences).toEqual([]);
  expect((await recallExperiences(f.owner, { itemId: replacementId })).experiences).toHaveLength(1);
  expect((await getExperience(f.owner, f.input.experienceId)).items).toMatchObject([
    { name: "Green shirt" }, { name: "Grey trousers", availability: "unavailable" },
  ]);
  await WardrobeItem.deleteOne({ _id: replacement._id });
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  await store.revise(f.owner, f.input.experienceId, changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 2,
    context: { kind: "user", text: "Dinner" } }, [f.itemId, replacementId]));
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({ sourceAvailable: false, source: null,
    items: [{ name: "Green shirt" }, { name: "Grey trousers", availability: "missing" }],
    state: { context: { exactScopeKey: "Dinner" } } });
});

it("corrects outcome after source redaction without reviving unconfirmed suggested context", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  const initial = changed({ ...f.input, context: { kind: "suggestion", confirmed: false } }, [f.itemId, items.bottom]);
  await store.create(f.owner, initial);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  await store.revise(f.owner, f.input.experienceId, changed({ ...f.state, context: { kind: "suggestion", confirmed: false },
    outcome: "worked", operationId: randomUUID(), expectedPreviousRevision: 1 }, [f.itemId, items.bottom]));
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({ sourceAvailable: false,
    state: { outcome: "worked", context: { rawOccasion: "", exactScopeKey: null, confirmed: false } },
    items: [{ name: "Green shirt" }, { name: "Dark trousers" }] });
});

it("allows only one competing membership correction and lets erasure win an in-flight correction", async () => {
  const f = await experienceFixture(); const items = await wardrobe(f.owner); const store = new ExperienceStore({ now });
  await store.create(f.owner, changed(f.input, [f.itemId, items.bottom]));
  const edits = [items.shoes, items.outer].map(id => changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 }, [f.itemId, items.bottom, id]));
  const rendezvous = (() => { let count = 2; let release!: () => void; const ready = new Promise<void>(r => { release = r; }); return async () => { if (--count === 0) release(); await ready; }; })();
  const concurrent = new ExperienceStore({ now, beforeWrite: rendezvous });
  const results = await Promise.allSettled(edits.map(edit => concurrent.revise(f.owner, f.input.experienceId, edit)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);

  const g = gate(); const delayed = new ExperienceStore({ now, beforeWrite: g.block });
  const pending = delayed.revise(f.owner, f.input.experienceId, changed({ ...f.state, operationId: randomUUID(), expectedPreviousRevision: 2 }, [f.itemId, items.bottom, items.shoes]));
  await g.entered; await store.erase(f.owner, f.input.experienceId); g.release();
  await expect(pending).rejects.toMatchObject({ code: "experience_erased" });
  expect(await getExperience(f.owner, f.input.experienceId)).toEqual({ experienceId: f.input.experienceId, lifecycle: "erased" });
  expect(Object.keys((await experienceCollection().findOne({ experienceId: f.input.experienceId }))!).sort())
    .toEqual(["_id", "experienceId", "lifecycle", "user"]);
});
