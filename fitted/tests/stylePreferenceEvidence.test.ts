import { Types } from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { buildStylePreferenceEvidence, resolvePreferenceRows, type PreferenceLedgerRow, type PreferenceSnapshot } from "@/lib/stylePreferenceEvidence";
import { __resetInteractionRateLimit, postInteraction } from "@/lib/interactions";
import { gate } from "./helpers/experienceFixture";
import { deps, namedOwner, oid, react, request, styledSnapshot } from "./helpers/styleLearningFixture";
import { randomUUID } from "crypto";

let harness: MongoHarness;
beforeAll(async () => { harness = await startMemoryMongo([User, GenerationSnapshot, OutfitInteraction], { replicaSet: true }); }, 120_000);
afterAll(async () => { await harness.stop(); });
afterEach(async () => { await harness.clear(); __resetInteractionRateLimit(); });

it("uses captured garment facts and matching scope for both named affinity and preference evidence", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
  await react(f.owner, source);
  const otherWeather = await styledSnapshot(f.owner, { ...f.context, weather: "hot" }); await react(f.owner, otherWeather, "rejected");
  const result = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(result.memoryRevision).toBe(2);
  expect(result.styleContext).toMatchObject({ profileId: f.context.profileId, memoryRevision: 2, weather: "mild" });
  expect(result.interactionCountAtRequest).toBe(1);
  expect(result.behavioralRows.interactionRows.map(row => row.snapshotId)).toEqual([source.snapshotId]);
  expect(result.behavioralRows.recentSnapshots).toHaveLength(2); // exposure is owner-wide, not taste transfer
  expect(result.preferenceRows).toHaveLength(1);
  expect(result.preferenceRows[0]).toMatchObject({ learningEnabled: true, learningDisposition: "normal", context: { ownerId: f.owner, weather: "mild" }, items: [
    { id: source.topId, role: "top", subtype: "t_shirt", colors: ["white"], pattern: "solid", fit: "relaxed" },
    { id: source.bottomId, role: "bottom", subtype: "jeans", colors: ["blue"], pattern: "solid", fit: "slim" },
  ] });
  const unknown = await buildStylePreferenceEvidence(f.owner, f.selection, "unspecified");
  expect(unknown.preferenceRows).toEqual([]);
});

it("reads the full admitted ledger instead of losing a scoped vote behind 500 newer unscoped rows", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), reactionId = await react(f.owner, source);
  await OutfitInteraction.collection.updateOne({ _id: new Types.ObjectId(reactionId) }, { $set: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  await OutfitInteraction.collection.insertMany(Array.from({ length: 510 }, () => ({ user: new Types.ObjectId(f.owner), action: "accepted", eventKind: "reaction", createdAt: new Date(), snapshotId: new Types.ObjectId(), candidateId: "unscoped" })));
  const result = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(result.preferenceRows.map(row => row.id)).toEqual([reactionId]);
  expect(result.interactionCountAtRequest).toBe(1);
});

it("keeps the latest exceptional composition so an older normal vote cannot reappear", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
  await react(f.owner, source);
  const repeated = await styledSnapshot(f.owner, f.context, [source.topId, source.bottomId]);
  const latest = await react(f.owner, repeated);
  expect((await postInteraction(request({ kind: "learning_disposition", reactionId: latest, operationId: randomUUID(), expectedDispositionRevision: 0, learningDisposition: "exception" }), deps(f.owner))).status).toBe(200);
  const result = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(result.preferenceRows).toEqual([]);
  expect(result.behavioralRows.interactionRows).toHaveLength(2); // old item-memory semantics stay distinct
});

it("applies the 200-row limit after composition suppression and eligibility, including missing-fact suppressors", async () => {
  const f = await namedOwner();
  const ledger: PreferenceLedgerRow[] = [], sources: PreferenceSnapshot[] = [];
  for (let index = 0; index < 206; index++) {
    const top = oid(), bottom = oid(), snapshotId = oid(), id = oid();
    sources.push({ _id: snapshotId, user: f.owner, styleContext: f.context, shownCandidateIds: ["c0"], candidates: [{ candidateId: "c0", template: "two_piece", items: [{ itemId: top, role: "base_top" }, { itemId: bottom, role: "base_bottom" }] }],
      itemSnapshots: [{ itemId: top, engineVisible: { subtype: "t_shirt", colorTags: ["white"] } }, { itemId: bottom, engineVisible: { subtype: "jeans", colorTags: ["blue"] } }] });
    ledger.push({ _id: id, user: f.owner, snapshotId, candidateId: "c0", action: index % 2 ? "accepted" : "rejected", styleContext: f.context,
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000), learningDisposition: index < 6 ? "normal" : "exception" });
  }
  expect(resolvePreferenceRows(ledger, sources, f.owner, f.context)).toHaveLength(6);
  const newerMissing = { ...sources[0], _id: oid(), itemSnapshots: [] };
  sources.push(newerMissing);
  ledger.push({ ...ledger[0], _id: oid(), snapshotId: String(newerMissing._id), createdAt: new Date("2026-02-01T00:00:00Z") });
  const result = resolvePreferenceRows(ledger, sources, f.owner, f.context);
  expect(result).toHaveLength(5);
  expect(result.some(row => row.id === String(ledger[0]._id))).toBe(false);
});

it("tombstones and foreign/missing source evidence cannot contribute, while unknown facts remain unknown", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context); await react(f.owner, source);
  await GenerationSnapshot.collection.updateOne({ _id: new Types.ObjectId(source.snapshotId) }, { $unset: { "itemSnapshots.0.engineVisible.subtype": "", "itemSnapshots.0.engineVisible.pattern": "" } });
  expect((await buildStylePreferenceEvidence(f.owner, f.selection, "mild")).preferenceRows[0].items[0]).toMatchObject({ subtype: null, pattern: null });
  const rows = await OutfitInteraction.find({ user: f.owner }).lean() as unknown as PreferenceLedgerRow[];
  const snapshots = await GenerationSnapshot.find({ user: f.owner }).lean() as unknown as PreferenceSnapshot[];
  expect(resolvePreferenceRows(rows, snapshots.map(row => ({ ...row, user: oid() })), f.owner, f.context)).toEqual([]);
  expect(resolvePreferenceRows(rows, snapshots.map(row => ({ ...row, shownCandidateIds: [] })), f.owner, f.context)).toEqual([]);
  await User.updateOne({ _id: f.owner }, { $push: { "styleMemory.tombstones": { kind: "board", id: f.context.boardId, profileId: f.context.profileId, revision: 1 } } });
  await expect(buildStylePreferenceEvidence(f.owner, f.selection, "mild")).rejects.toMatchObject({ code: "context_unavailable" });
});

it("captures revision and feedback from one Mongo snapshot when a vote races evidence preparation", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context), pause = gate();
  let blocked = false;
  const reading = buildStylePreferenceEvidence(f.owner, f.selection, "mild", { afterOwnerRead: async () => { if (!blocked) { blocked = true; await pause.block(); } } });
  await pause.entered;
  try { await react(f.owner, source); } finally { pause.release(); }
  const before = await reading;
  expect(before.memoryRevision).toBe(0); expect(before.preferenceRows).toEqual([]);
  const after = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(after.memoryRevision).toBe(1); expect(after.preferenceRows).toHaveLength(1);
});

it("requires explicit historical-version inheritance instead of relabeling old evidence", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context); await react(f.owner, source);
  await User.updateOne({ _id: f.owner }, { $set: { "styleMemory.boards.0.currentVersion": 2 }, $push: { "styleMemory.boards.0.versions": {
    version: 2, createdAt: new Date().toISOString(), rawSource: "new meaning", compiled: f.context.compiled } } });
  await expect(buildStylePreferenceEvidence(f.owner, f.selection, "mild")).rejects.toMatchObject({ code: "version_conflict" });
  const historical = await buildStylePreferenceEvidence(f.owner, f.selection, "mild", { allowHistoricalVersions: true });
  expect(historical.styleContext.profileVersion).toBe(1);
  expect(historical.preferenceRows).toHaveLength(1);
});


it("keeps Board-only repeat requests usable after feedback without sending a null-Routine learning row", async () => {
  const f = await namedOwner();
  const context = { ...f.context, routineId: null, routineVersion: null, routineLabel: null, learningEnabled: false };
  const selection = { ...f.selection, routineId: null, routineVersion: null, learningEnabled: false };
  const source = await styledSnapshot(f.owner, context);
  await react(f.owner, source);
  const repeat = await buildStylePreferenceEvidence(f.owner, selection, "mild");
  expect(repeat.styleContext).toMatchObject({ routineId: null, learningEnabled: false });
  expect(repeat.behavioralRows.interactionRows).toHaveLength(1);
  expect(repeat.preferenceRows).toEqual([]);
});


it("inherits the original situation meaning after a semantic edit instead of using the new version's label", async () => {
  const f = await namedOwner();
  const { StyleMemoryStore } = await import("@/lib/styleMemory/store");
  const store = new StyleMemoryStore();
  await store.mutate(f.owner, { kind: "rename_routine", operationId: randomUUID(), expectedRevision: 0,
    routineId: f.selection.routineId!, label: "Campus days" });
  expect((await buildStylePreferenceEvidence(f.owner, f.selection, "mild")).styleContext.routineLabel).toBe("Campus days");
  await store.mutate(f.owner, { kind: "edit_routine", operationId: randomUUID(), expectedRevision: 1,
    routineId: f.selection.routineId!, label: "Gym sessions" });
  const inherited = await buildStylePreferenceEvidence(f.owner, f.selection, "mild", { allowHistoricalVersions: true });
  expect(inherited.styleContext.routineVersion).toBe(1);
  expect(inherited.styleContext.routineLabel).toBe("Class");
  await expect(buildStylePreferenceEvidence(f.owner, f.selection, "mild")).rejects.toMatchObject({ code: "version_conflict" });
});
