import { randomUUID } from "crypto";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { getExperience, getSuggestion, recentSuggestions } from "@/lib/outfitExperience/read";
import { OutfitPlanningStore } from "@/lib/outfitPlanning/store";
import { postInteraction, getInteractions, __resetInteractionRateLimit } from "@/lib/interactions";
import { buildBehavioralRows } from "@/lib/mlBehavioralRows";
import { visibleSnapshots } from "@/lib/snapshotVisibility";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture } from "./helpers/experienceFixture";

let harness: MongoHarness;
const now = () => new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { harness = await startMemoryMongo([OutfitExperience, User, OutfitInteraction], { replicaSet: true }); }, 120_000);
afterEach(async () => { jest.restoreAllMocks(); __resetInteractionRateLimit(); await harness.clear(); });
afterAll(async () => { await harness.stop(); });

it.each(["revise", "retract", "erase"] as const)("hides stale derived content after interrupted %s without depending on cleanup", async mutation => {
  const f = await experienceFixture();
  const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  const original = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!;
  const candidate = original.candidates[0];
  await WardrobeItem.create({ _id: new Types.ObjectId(candidate.items[1].itemId), user: new Types.ObjectId(f.owner),
    name: "Blue jeans", clothingType: "bottom", category: "bottom", warmth: 4, colors: ["blue"] });
  const childId = new Types.ObjectId();
  await GenerationSnapshot.collection.insertOne({ ...original, _id: childId, occasion: "Private dinner",
    variationSourceExperienceId: f.input.experienceId, variationSourceRevision: 1,
    shownCandidateIds: ["c0"], shownFullSignatures: ["private-signature"], nSurfaced: 1,
    candidates: [{ ...candidate, baseKey: "private-base", fullSignature: "private-signature" }] });
  const deps = { verifyUser: async () => ({ userId: f.owner }), models: { OutfitInteraction, GenerationSnapshot, User } };
  const reactionRequest = { headers: { get: () => "Bearer test" }, json: async () => ({ snapshotId: String(childId), candidateId: "c0", action: "accepted" }) };
  expect((await postInteraction(reactionRequest as never, deps)).status).toBe(200);
  const plans = new OutfitPlanningStore({ now });
  const plan = { planId: randomUUID(), snapshotId: String(childId), candidateId: "c0", plannedFor: "2026-10-11", timezone: "UTC" };
  await plans.create(f.owner, plan);
  const later = { ...f.input, experienceId: randomUUID(), operationId: randomUUID(), snapshotId: String(childId) };
  await store.create(f.owner, later);
  expect((await getSuggestion(f.owner, String(childId), "c0")).suggestionContext).toBe("Private dinner");

  // The real native mutation lands, then its process dies before redactDerived.
  const interrupted = new ExperienceStore({ now, afterNativeWrite: async operation => {
    if (operation === mutation) throw new Error("interrupted after commit");
  } });
  const command = { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1, outcome: "worked" };
  await expect(mutation === "erase" ? interrupted.erase(f.owner, f.input.experienceId)
    : mutation === "retract" ? interrupted.retract(f.owner, f.input.experienceId, { operationId: command.operationId, expectedPreviousRevision: 1 })
      : interrupted.revise(f.owner, f.input.experienceId, command)).rejects.toThrow("interrupted after commit");
  expect((await experienceCollection().findOne({ experienceId: f.input.experienceId }))!.lifecycle).toBe(mutation === "erase" ? "erased" : mutation === "retract" ? "retracted" : "active");
  expect((await GenerationSnapshot.collection.findOne({ _id: childId }))!.redacted).toBe(false);

  await expect(getSuggestion(f.owner, String(childId), "c0")).rejects.toMatchObject({ code: "source_unavailable" });
  expect((await recentSuggestions(f.owner, f.itemId)).suggestions.some(row => row.snapshotId === String(childId))).toBe(false);
  expect((await plans.list(f.owner)).plans[0]).toMatchObject({ planId: plan.planId, suggestion: null });
  await expect(plans.create(f.owner, { ...plan, planId: randomUUID(), plannedFor: "2026-10-12" })).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(store.create(f.owner, { ...later, experienceId: randomUUID(), operationId: randomUUID() })).rejects.toMatchObject({ code: "source_unavailable" });
  expect((await postInteraction(reactionRequest as never, deps)).status).toBe(404);
  const history = await getInteractions({ headers: { get: () => "Bearer test" }, url: "http://localhost/api/interactions" } as never, deps);
  expect((await history.json()).interactions).toEqual([]);
  expect(await buildBehavioralRows(f.owner, { OutfitInteraction, GenerationSnapshot })).toEqual({ interactionRows: [], recentSnapshots: [] });
  const confirmed = await getExperience(f.owner, later.experienceId);
  expect(confirmed).toMatchObject({ sourceAvailable: false, source: null });
  expect(confirmed.items?.map(item => item.itemId)).toEqual(candidate.items.map((item: { itemId: string }) => item.itemId));
  expect(await getSuggestion(f.owner, String(f.snapshotId), "c0")).toBeDefined(); // Ordinary evidence remains independent.
  await plans.remove(f.owner, plan.planId);
});

it("fails closed for missing, foreign and malformed report lineage while keeping current and ordinary snapshots", async () => {
  const f = await experienceFixture();
  await new ExperienceStore({ now }).create(f.owner, f.input);
  const other = await experienceFixture();
  await new ExperienceStore({ now }).create(other.owner, other.input);
  const ordinary = { redacted: false };
  const current = { variationSourceExperienceId: f.input.experienceId, variationSourceRevision: 1 };
  const rows = [ordinary, current, { ...current, variationSourceRevision: 2 },
    { ...current, variationSourceExperienceId: other.input.experienceId },
    { ...current, variationSourceExperienceId: randomUUID() }, { variationSourceRevision: 1 },
    { variationSourceExperienceId: f.input.experienceId }, { ...current, variationSourceRevision: 0 }, { ...current, redacted: true }];
  expect(await visibleSnapshots(f.owner, rows)).toEqual([ordinary, current]);
});

it("removes a racing reaction when erasure commits after reaction persistence but before acknowledgement", async () => {
  const f = await experienceFixture();
  await new ExperienceStore({ now }).create(f.owner, f.input);
  const original = (await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))!;
  const childId = new Types.ObjectId();
  await GenerationSnapshot.collection.insertOne({ ...original, _id: childId,
    variationSourceExperienceId: f.input.experienceId, variationSourceRevision: 1,
    candidates: [{ ...original.candidates[0], baseKey: "base", fullSignature: "signature" }], shownCandidateIds: ["c0"] });
  const interrupted = new ExperienceStore({ now, afterNativeWrite: async operation => {
    if (operation === "erase") throw new Error("interrupted");
  } });
  const exists = User.exists.bind(User);
  // This guard runs after the reaction transaction commits. Keep create/session intact,
  // then erase the source in a fresh transaction before the final visibility recheck.
  jest.spyOn(User, "exists").mockImplementationOnce((async (query: Record<string, unknown>) => {
    expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(1);
    await expect(interrupted.erase(f.owner, f.input.experienceId)).rejects.toThrow("interrupted");
    return exists(query);
  }) as never);
  const response = await postInteraction({ headers: { get: () => "Bearer test" },
    json: async () => ({ snapshotId: String(childId), candidateId: "c0", action: "accepted" }) } as never,
    { verifyUser: async () => ({ userId: f.owner }), models: { OutfitInteraction, GenerationSnapshot, User } });
  expect(response.status).toBe(404);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(0);
  expect((await GenerationSnapshot.collection.findOne({ _id: childId }))!.redacted).toBe(false);
});
