import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { GET as suggestionGET } from "@/app/api/experiences/suggestion/route";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { Types } from "mongoose";
import OutfitExperience, { experienceCollection } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import WardrobeItem from "@/models/WardrobeItem";
import User from "@/models/User";
import { ExperienceStore } from "@/lib/outfitExperience/store";
import { getExperience, getSuggestion, recallExperiences, recentSuggestions } from "@/lib/outfitExperience/read";
import type { MemorySnapshot } from "@/lib/outfitExperience/source";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { experienceFixture } from "./helpers/experienceFixture";

jest.mock("@/lib/apiAuth", () => ({ verifyFirebaseUser: jest.fn() }));
jest.mock("@/lib/mlServiceClient", () => ({ callRenderService: jest.fn(async () => ({})) }));
let harness: MongoHarness | undefined;
const now = () => new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { harness = await startMemoryMongo([OutfitExperience, User], { replicaSet: true }); }, 120_000);
afterEach(async () => { await harness?.clear(); });
afterAll(async () => { await harness?.stop(); });

it("finds shown suggestions without likes and retains candidate siblings across pages", async () => {
  const f = await experienceFixture();
  const first = await recentSuggestions(f.owner, f.itemId, { limit: 1 });
  expect(first.suggestions.map(c => c.candidateId)).toEqual(["c0"]);
  const second = await recentSuggestions(f.owner, f.itemId, { limit: 1, cursor: first.nextCursor! });
  expect(second.suggestions.map(c => c.candidateId)).toEqual(["c1"]);
  const end = await recentSuggestions(f.owner, f.itemId, { limit: 1, cursor: second.nextCursor! });
  expect(end).toEqual({ suggestions: [], nextCursor: null });
  expect(await OutfitInteraction.countDocuments()).toBe(0);
  // Presence in itemSnapshots alone does not mean the item appeared in a shown candidate.
  const unused = String(new Types.ObjectId());
  await GenerationSnapshot.db.db!.collection<MemorySnapshot>(GenerationSnapshot.collection.name)
    .updateOne({ _id: f.snapshotId }, { $push: { itemSnapshots: { itemId: unused } } });
  expect((await recentSuggestions(f.owner, unused)).suggestions).toEqual([]);
});

it("uses latest state before filters and never returns an older positive context after correction", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, { ...f.input, outcome: "worked" });
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1,
    context: { kind: "user", text: "Dinner" }, outcome: "change_next_time" });
  expect((await recallExperiences(f.owner, { context: "Class" })).experiences).toEqual([]);
  expect((await recallExperiences(f.owner, { outcome: "worked" })).experiences).toEqual([]);
  expect((await recallExperiences(f.owner, { context: "Dinner", outcome: "change_next_time", itemId: f.itemId })).experiences).toHaveLength(1);
  const view = await getExperience(f.owner, f.input.experienceId);
  expect(JSON.stringify(view)).not.toContain("requestKey");
  expect(JSON.stringify(view)).not.toContain("revisions");
});

it("returns continuation through sparse matches instead of pretending history is exhausted", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, { ...f.input, context: { kind: "user", text: "Target" } });
  for (let i = 0; i < 101; i++) await store.create(f.owner, { ...f.input, experienceId: randomUUID(), operationId: randomUUID() });
  const first = await recallExperiences(f.owner, { context: "Target" });
  expect(first.experiences).toEqual([]);
  expect(first.nextCursor).not.toBeNull();
  const second = await recallExperiences(f.owner, { context: "Target", cursor: first.nextCursor! });
  expect(second.experiences.map(e => e.experienceId)).toEqual([f.input.experienceId]);
  expect(second.nextCursor).toBeNull();
});

it("keeps a source continuation when a bounded snapshot batch has no matching candidate", async () => {
  const f = await experienceFixture();
  await GenerationSnapshot.collection.insertMany(Array.from({ length: 101 }, () => ({
    _id: new Types.ObjectId(), user: new Types.ObjectId(f.owner), shownCandidateIds: [], candidates: [], itemSnapshots: [],
  })));
  const first = await recentSuggestions(f.owner, f.itemId);
  expect(first.suggestions).toEqual([]); expect(first.nextCursor).not.toBeNull();
  const second = await recentSuggestions(f.owner, f.itemId, { cursor: first.nextCursor! });
  expect(second.suggestions.map(s => s.candidateId)).toEqual(["c0", "c1"]);
});

it("enforces owner scoping and rejects cursors for a different owner or filter", async () => {
  const f = await experienceFixture(); const other = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  await expect(getExperience(other.owner, f.input.experienceId)).rejects.toMatchObject({ code: "experience_unavailable" });
  expect((await recallExperiences(other.owner, { itemId: f.itemId })).experiences).toEqual([]);
  const sources = await recentSuggestions(f.owner, f.itemId, { limit: 1 });
  await expect(recentSuggestions(other.owner, f.itemId, { cursor: sources.nextCursor! })).rejects.toThrow("Invalid cursor");
  await expect(recentSuggestions(f.owner, other.itemId, { cursor: sources.nextCursor! })).rejects.toThrow("Invalid cursor");
  await expect(recallExperiences(f.owner, { cursor: "broken" })).rejects.toThrow("Invalid cursor");
  await expect(recallExperiences(f.owner, { limit: 21 })).rejects.toThrow("page size");
});

it("shows current unavailability and changes without rewriting the historical item", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  await WardrobeItem.updateOne({ _id: f.itemId }, { $set: { name: "Renamed shirt", isAvailable: false } });
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({
    items: [{ itemId: f.itemId, name: "Green shirt", availability: "unavailable", changed: true }, { availability: "missing" }],
  });
  await WardrobeItem.deleteOne({ _id: f.itemId });
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({ items: [{ name: "Green shirt", availability: "missing" }, { availability: "missing" }] });
});

it("hides redacted source items, keeps confirmed personal context and preserves an erase action", async () => {
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  await store.create(f.owner, f.input);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  expect(await getExperience(f.owner, f.input.experienceId)).toMatchObject({
    sourceAvailable: false, source: null, items: [{ name: "Green shirt" }, { name: "Unknown item" }],
    state: { context: { exactScopeKey: "Class" } },
  });
  expect((await recentSuggestions(f.owner, f.itemId)).suggestions).toEqual([]);
  await store.erase(f.owner, f.input.experienceId);
  expect((await recallExperiences(f.owner)).experiences).toEqual([]);
});

it("memory writes and reads do not call the generator or alter legacy reactions", async () => {
  const call = jest.requireMock("@/lib/mlServiceClient").callRenderService as jest.Mock;
  await call(); expect(call).toHaveBeenCalledTimes(1); call.mockClear(); // counter positive control
  const f = await experienceFixture(); const store = new ExperienceStore({ now });
  const reaction = { _id: new Types.ObjectId(), user: new Types.ObjectId(f.owner), action: "accepted" };
  await OutfitInteraction.collection.insertOne(reaction);
  await store.create(f.owner, f.input);
  await store.revise(f.owner, f.input.experienceId, { ...f.state, operationId: randomUUID(), expectedPreviousRevision: 1 });
  await getExperience(f.owner, f.input.experienceId); await recallExperiences(f.owner); await recentSuggestions(f.owner, f.itemId);
  await store.erase(f.owner, f.input.experienceId);
  expect(call).not.toHaveBeenCalled();
  expect(await OutfitInteraction.collection.findOne({ _id: reaction._id })).toEqual(reaction);
  expect(await experienceCollection().countDocuments()).toBe(1); // minimal erase marker only
});

it("opens an exact shown proposal beyond paging without creating wear or bypassing visibility", async () => {
  const f = await experienceFixture();
  await GenerationSnapshot.collection.insertMany(Array.from({ length: 101 }, () => ({
    _id: new Types.ObjectId(), user: new Types.ObjectId(f.owner), shownCandidateIds: [], candidates: [], itemSnapshots: [],
  })));
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { "candidates.0.styleMove": { oneSentence: "Tuck the green shirt." }, weatherRaw: "Light rain, 16°C" } });
  expect(await getSuggestion(f.owner, String(f.snapshotId), "c0")).toMatchObject({
    styleMove: { oneSentence: "Tuck the green shirt." }, weatherContext: "Light rain, 16°C",
    snapshotId: String(f.snapshotId), candidateId: "c0", suggestionContext: "Class", shownVariationAllowed: true,
    items: [{ itemId: f.itemId, name: "Green shirt", availability: "available" }, { availability: "missing" }] });
  expect(await OutfitExperience.countDocuments()).toBe(0);
  for (const [owner, id, candidate] of [
    [String(new Types.ObjectId()), String(f.snapshotId), "c0"],
    [f.owner, String(f.snapshotId), "not-shown"], [f.owner, String(new Types.ObjectId()), "c0"],
  ]) await expect(getSuggestion(owner, id, candidate)).rejects.toMatchObject({ code: "source_unavailable" });
  await expect(getSuggestion(f.owner, "invalid", "c0")).rejects.toThrow();
  await expect(getSuggestion(f.owner, String(f.snapshotId), "")).rejects.toThrow("Invalid candidate ID");
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { variationSourceExperienceId: "report-bound", variationSourceRevision: 1 } });
  await experienceCollection().insertOne({ user: new Types.ObjectId(f.owner), experienceId: "report-bound", lifecycle: "active", currentRevision: 1 });
  expect((await getSuggestion(f.owner, String(f.snapshotId), "c0")).shownVariationAllowed).toBe(false);
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { redacted: true } });
  await expect(getSuggestion(f.owner, String(f.snapshotId), "c0")).rejects.toMatchObject({ code: "source_unavailable" });
});

it("serves the exact lookup with authentication, strict query validation and no-store responses", async () => {
  const f = await experienceFixture();
  const auth = verifyFirebaseUser as jest.Mock;
  const path = `http://localhost/api/experiences/suggestion?snapshotId=${f.snapshotId}&candidateId=c0`;
  auth.mockResolvedValue({ error: "Missing token", status: 401 });
  expect((await suggestionGET(new NextRequest(path))).status).toBe(401);
  auth.mockResolvedValue({ userId: f.owner });
  const result = await suggestionGET(new NextRequest(path));
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(await result.json()).toMatchObject({ suggestion: { candidateId: "c0", snapshotId: String(f.snapshotId) } });
  for (const query of ["", `snapshotId=${f.snapshotId}`, `snapshotId=${f.snapshotId}&candidateId=`,
    `snapshotId=${f.snapshotId}&candidateId=c0&candidateId=c1`, `snapshotId=${f.snapshotId}&candidateId=c0&owner=other`]) {
    expect((await suggestionGET(new NextRequest(`http://localhost/api/experiences/suggestion?${query}`))).status).toBe(400);
  }
  auth.mockResolvedValue({ userId: String(new Types.ObjectId()) });
  expect((await suggestionGET(new NextRequest(path))).status).toBe(404);
});

it.each(["manual", "current", "forecast", "occasion", "default", "unknown", undefined])("projects saved weather provenance %s without rewriting the snapshot", async weatherSource => {
  const f = await experienceFixture();
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { weather: "cold", weatherRaw: "Cold; rain expected", ...(weatherSource ? { weatherSource } : {}) } });
  const before = await GenerationSnapshot.collection.findOne({ _id: f.snapshotId });
  expect(await getSuggestion(f.owner, String(f.snapshotId), "c0")).toMatchObject({ weatherContext: "Cold; rain expected", weatherSource: weatherSource ?? "unknown" });
  expect(await GenerationSnapshot.collection.findOne({ _id: f.snapshotId })).toEqual(before);
  expect(await OutfitExperience.countDocuments()).toBe(0);
  expect(await OutfitInteraction.countDocuments()).toBe(0);
});

it("saved unlayered proposal explains the original layer option without claiming this outfit includes it", async () => {
  const f = await experienceFixture();
  const offered = { status: "offered", note: "An optional removable layer is included. Rain and wind protection are unknown; check the garment and conditions before relying on it." };
  await GenerationSnapshot.collection.updateOne({ _id: f.snapshotId }, { $set: { layerChoice: offered, weatherSignals: { rain: true, wind: false } } });
  const suggestion = await getSuggestion(f.owner, String(f.snapshotId), "c0");
  expect(suggestion.weatherSignals).toEqual({ rain: true, wind: false });
  expect(suggestion.layerChoice?.note).toContain("This proposal does not include an outer layer");
  expect((await GenerationSnapshot.collection.findOne({ _id: f.snapshotId }))?.layerChoice).toEqual(offered);
});
