import { randomUUID, createHash } from "crypto";
import { Types } from "mongoose";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { StyleMemoryStore, readStyleMemoryOwner } from "@/lib/styleMemory/store";
import { findExclusionSet, type ExclusionScopeSelection, type SetExclusionsCommand } from "@/lib/styleMemory/contract";
import { exclusionSetId } from "@/lib/styleMemory/exclusions";
import { parseStyleMemoryCommand } from "@/lib/styleMemory/validation";
import { styleMemoryRequest } from "@/lib/styleMemory/client";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";

let harness: MongoHarness;
const id = () => String(new Types.ObjectId());
const store = new StyleMemoryStore();
const compiled = { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] };
beforeAll(async () => { harness = await startMemoryMongo([User, WardrobeItem, OutfitInteraction, GenerationSnapshot], { replicaSet: true }); }, 120_000);
afterEach(async () => { jest.restoreAllMocks(); await harness.clear(); });
afterAll(async () => { await harness.stop(); });
const revision = async (owner: string) => (await readStyleMemoryOwner(owner)).revision;
async function change(owner: string, command: Record<string, unknown>) {
  return store.mutate(owner, { operationId: randomUUID(), expectedRevision: await revision(owner), ...command });
}
async function fixture(count = 3) {
  const owner = String((await User.create({ authId: randomUUID(), email: `${randomUUID()}@example.test` }))._id);
  const boardId = id(), profileId = id(), routineId = id();
  await change(owner, { kind: "create_board", id: boardId, profileId, label: "Campus", rawSource: "relaxed", compiled });
  await change(owner, { kind: "create_routine", id: routineId, label: "Class" });
  const members = Array.from({ length: count }, id);
  await WardrobeItem.insertMany(members.map((member, index) => ({ _id: member, user: owner, name: `Owned ${index}`,
    clothingType: index === 0 ? "dress" : "top", category: index === 0 ? "dress" : "top", warmth: 5, isAvailable: index !== 0 })));
  const scope: ExclusionScopeSelection = { boardId, profileId, profileVersion: 1, routineId, routineVersion: 1 };
  return { owner, scope, members };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const command = (f: Fixture, overrides: Partial<SetExclusionsCommand> = {}): SetExclusionsCommand => ({
  kind: "set_exclusions", operationId: randomUUID(), expectedRevision: 2, boardId: f.scope.boardId, profileVersion: 1,
  routineId: f.scope.routineId, routineVersion: 1, expectedSetRevision: 0, itemIds: [], outfitItemIds: [], ...overrides,
});
const saved = async (f: Fixture, scope = f.scope) => findExclusionSet(await store.list(f.owner), scope)!;

it("stores canonical semantic identities for owned unavailable pieces without changing prior evidence", async () => {
  const f = await fixture(), [dress, top, other] = f.members;
  const snapshotId = new Types.ObjectId(), reactionId = new Types.ObjectId(), user = new Types.ObjectId(f.owner);
  await GenerationSnapshot.collection.insertOne({ _id: snapshotId, user, occasion: "Earlier class", shownCandidateIds: ["original"],
    candidates: [{ candidateId: "original", template: "one_piece", items: [{ itemId: dress, role: "one_piece" }] }] });
  await OutfitInteraction.collection.insertOne({ _id: reactionId, user, snapshotId, candidateId: "original", eventKind: "reaction",
    action: "accepted", items: [new Types.ObjectId(dress)], createdAt: new Date("2026-01-01T00:00:00Z"), learningDisposition: "normal", dispositionRevision: 0 });
  const snapshotBefore = await GenerationSnapshot.collection.findOne({ _id: snapshotId });
  const voteBefore = await OutfitInteraction.collection.findOne({ _id: reactionId });
  const result = await store.mutate(f.owner, command(f, { itemIds: [top, dress], outfitItemIds: [[other, top], [dress]] }));
  const set = findExclusionSet(result.state, f.scope)!;
  const tuple = [f.scope.boardId, f.scope.profileId, 1, f.scope.routineId, 1];
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
  expect(set.id).toBe(hash(tuple)); expect(set.revision).toBe(3);
  expect(set.entries).toHaveLength(4);
  for (const entry of set.entries) {
    expect(entry.id).toBe(hash([tuple, entry.kind, [...entry.itemIds].sort()]));
    expect(entry.revision).toBe(3); expect(entry.itemIds).toEqual([...entry.itemIds].sort());
  }
  expect(set.entries.some(entry => entry.kind === "combination" && entry.itemIds.length === 1 && entry.itemIds[0] === dress)).toBe(true);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(1);
  expect(await GenerationSnapshot.countDocuments({ user: f.owner })).toBe(1);
  expect(await OutfitInteraction.collection.findOne({ _id: reactionId })).toEqual(voteBefore);
  expect(await GenerationSnapshot.collection.findOne({ _id: snapshotId })).toEqual(snapshotBefore);
  expect((await store.list(f.owner)).boards[0].learningOptIns).toEqual([]);
});

it("retries canonical equivalents once, rejects stale set/owner revisions and serializes competing replacements", async () => {
  const f = await fixture(), original = command(f, { itemIds: f.members.slice(0, 2), outfitItemIds: [[...f.members].reverse()] });
  let lose = true;
  const unreliable = new StyleMemoryStore({ afterWrite: async () => { if (lose) { lose = false; throw new Error("lost acknowledgement"); } } });
  await expect(unreliable.mutate(f.owner, original)).rejects.toThrow("lost acknowledgement");
  const retry = await store.mutate(f.owner, { ...original, itemIds: [...original.itemIds].reverse(), outfitItemIds: [f.members] });
  expect(retry.operation.revision).toBe(3); expect(await revision(f.owner)).toBe(3);
  await expect(store.mutate(f.owner, { ...original, itemIds: [] })).rejects.toMatchObject({ code: "operation_conflict" });
  await expect(store.mutate(f.owner, command(f, { expectedRevision: 3 }))).rejects.toMatchObject({ code: "exclusion_revision_conflict" });
  await expect(store.mutate(f.owner, command(f, { expectedSetRevision: 3 }))).rejects.toMatchObject({ code: "revision_conflict" });
  const races = await Promise.allSettled(f.members.slice(0, 2).map(member => store.mutate(f.owner,
    command(f, { expectedRevision: 3, expectedSetRevision: 3, itemIds: [member] }))));
  expect(races.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await revision(f.owner)).toBe(4); expect((await saved(f)).revision).toBe(4);
});

it("retains unchanged entry revisions, advances restored rules, and undoes a full set", async () => {
  const f = await fixture(20);
  const first = await store.mutate(f.owner, command(f, { itemIds: f.members, outfitItemIds: f.members.map(member => [member]) }));
  const old = findExclusionSet(first.state, f.scope)!;
  const one = f.members[0], retained = old.entries.find(entry => entry.kind === "item" && entry.itemIds[0] === one)!;
  await store.mutate(f.owner, command(f, { expectedRevision: 3, expectedSetRevision: 3, itemIds: [one] }));
  expect((await saved(f)).entries).toEqual([retained]);
  await store.mutate(f.owner, command(f, { expectedRevision: 4, expectedSetRevision: 4 }));
  expect(await saved(f)).toMatchObject({ id: old.id, revision: 5, entries: [] });
  await store.mutate(f.owner, command(f, { expectedRevision: 5, expectedSetRevision: 5, itemIds: [one] }));
  expect((await saved(f)).entries).toEqual([{ ...retained, revision: 6 }]);
});

it("requires owned new rule targets while retained deleted references stay inert and removable", async () => {
  const f = await fixture(), other = await fixture(), missing = id();
  for (const member of [other.members[0], missing]) {
    await expect(store.mutate(f.owner, command(f, { itemIds: [member] }))).rejects.toMatchObject({ code: "exclusion_item_unavailable" });
    expect(await revision(f.owner)).toBe(2); expect(await saved(f)).toBeNull();
  }
  await store.mutate(f.owner, command(f, { itemIds: [f.members[0]] })); // unavailable but owned is valid
  const previous = await saved(f);
  await WardrobeItem.deleteOne({ _id: f.members[0], user: f.owner });
  await store.mutate(f.owner, command(f, { expectedRevision: 3, expectedSetRevision: 3, itemIds: [f.members[0]] }));
  expect((await saved(f)).entries).toEqual(previous.entries);
  await expect(store.mutate(f.owner, command(f, { expectedRevision: 4, expectedSetRevision: 4,
    itemIds: [f.members[0]], outfitItemIds: [[f.members[0], f.members[1]]] }))).rejects.toMatchObject({ code: "exclusion_item_unavailable" });
  await store.mutate(f.owner, command(f, { expectedRevision: 4, expectedSetRevision: 4 }));
  expect((await saved(f)).entries).toEqual([]);
  await expect(store.mutate(f.owner, command(f, { expectedRevision: 5, expectedSetRevision: 5, itemIds: [f.members[0]] })))
    .rejects.toMatchObject({ status: 400, code: "exclusion_item_unavailable" });
  expect(await revision(f.owner)).toBe(5); expect((await saved(f)).entries).toEqual([]);
  await expect(store.mutate(other.owner, command(f, { expectedRevision: 2 }))).rejects.toMatchObject({ code: "board_unavailable" });
});

it("keeps retained old semantic scopes separate, rejects archive and purges erased Routine sets across Boards", async () => {
  const f = await fixture();
  await store.mutate(f.owner, command(f, { itemIds: [f.members[0]] }));
  await change(f.owner, { kind: "edit_board", boardId: f.scope.boardId, rawSource: "formal", compiled });
  await change(f.owner, { kind: "edit_routine", routineId: f.scope.routineId, label: "Dinner" });
  expect(await saved(f, { ...f.scope, profileVersion: 2, routineVersion: 2 })).toBeNull();
  await store.mutate(f.owner, command(f, { expectedRevision: 5, expectedSetRevision: 3, itemIds: [f.members[1]] }));
  const secondBoard = id(), secondProfile = id();
  await change(f.owner, { kind: "create_board", id: secondBoard, profileId: secondProfile, label: "Other", rawSource: "relaxed", compiled });
  await change(f.owner, { ...command(f), boardId: secondBoard, expectedRevision: 7, itemIds: [f.members[2]] });
  await change(f.owner, { ...command(f), expectedRevision: 8, routineId: null, routineVersion: null, itemIds: [f.members[0]] });
  await change(f.owner, { kind: "archive_board", boardId: f.scope.boardId });
  await expect(store.mutate(f.owner, command(f, { expectedRevision: 10, expectedSetRevision: 6 }))).rejects.toMatchObject({ code: "context_archived" });
  await change(f.owner, { kind: "restore_board", boardId: f.scope.boardId });
  await change(f.owner, { kind: "archive_routine", routineId: f.scope.routineId });
  await expect(store.mutate(f.owner, command(f, { expectedRevision: 12, expectedSetRevision: 6 }))).rejects.toMatchObject({ code: "context_archived" });
  await change(f.owner, { kind: "erase_routine", routineId: f.scope.routineId });
  const after = await store.list(f.owner);
  expect(after.boards.every(board => board.exclusionSets?.every(set => set.routineId !== f.scope.routineId) ?? true)).toBe(true);
  expect(findExclusionSet(after, { ...f.scope, routineId: null, routineVersion: null })?.entries).toHaveLength(1);
});

it("bounds input membership/counts and permits clearing existing scopes at the 128-set limit", async () => {
  const f = await fixture(21), base = command(f);
  for (const extra of [{ itemIds: f.members }, { itemIds: [f.members[0], f.members[0]] }, { outfitItemIds: [[]] },
    { outfitItemIds: [f.members.slice(0, 6)] }, { outfitItemIds: [[f.members[0], f.members[0]]] },
    { outfitItemIds: [f.members.slice(0, 2), f.members.slice(0, 2).reverse()] }, { outfitItemIds: f.members.map(member => [member]) },
    { routineId: null, routineVersion: 1 }, { routineId: f.scope.routineId, routineVersion: null }, { expectedSetRevision: -1 }, { hidden: true }]) {
    expect(() => parseStyleMemoryCommand({ ...base, ...extra })).toThrow();
  }
  const owner = await readStyleMemoryOwner(f.owner), board = owner.data.boards[0], routine = owner.data.routines[0];
  board.versions = Array.from({ length: 16 }, (_, index) => ({ ...board.versions[0], version: index + 1 }));
  routine.versions = Array.from({ length: 8 }, (_, index) => ({ ...routine.versions[0], version: index + 1 }));
  board.exclusionSets = board.versions.flatMap(profile => routine.versions.map(situation => {
    const scope = { ...f.scope, profileVersion: profile.version, routineVersion: situation.version };
    return { id: exclusionSetId(scope), revision: 2, profileVersion: scope.profileVersion, routineId: scope.routineId, routineVersion: scope.routineVersion, entries: [] };
  }));
  await User.collection.updateOne({ _id: new Types.ObjectId(f.owner) }, { $set: { styleMemory: owner.data } });
  await expect(store.mutate(f.owner, command(f, { routineId: null, routineVersion: null }))).rejects.toMatchObject({ code: "exclusion_scope_limit" });
  await store.mutate(f.owner, command(f, { expectedSetRevision: 2 }));
  expect((await store.list(f.owner)).boards[0].exclusionSets).toHaveLength(128);
  expect((await saved(f)).revision).toBe(3);
});

it("rechecks new membership at admission and closes delayed saves after Board/account erasure", async () => {
  const f = await fixture();
  const wardrobeRace = new StyleMemoryStore({ beforeWrite: async () => { await WardrobeItem.deleteOne({ _id: f.members[0], user: f.owner }); } });
  await expect(wardrobeRace.mutate(f.owner, command(f, { itemIds: [f.members[0]] }))).rejects.toMatchObject({ code: "exclusion_item_unavailable" });
  expect(await revision(f.owner)).toBe(2);
  const boardRace = new StyleMemoryStore({ beforeWrite: async () => { await change(f.owner, { kind: "erase_board", boardId: f.scope.boardId }); } });
  await expect(boardRace.mutate(f.owner, command(f, { itemIds: [f.members[1]] }))).rejects.toMatchObject({ code: "revision_conflict" });
  const g = await fixture();
  const accountRace = new StyleMemoryStore({ beforeWrite: async () => { await User.updateOne({ _id: g.owner }, { $set: { erasureStarted: true } }); } });
  await expect(accountRace.mutate(g.owner, command(g, { itemIds: [g.members[0]] }))).rejects.toMatchObject({ code: "account_unavailable" });
});

it("keeps legacy browser states readable and rejects malformed saved-set acknowledgements", async () => {
  const f = await fixture(), client = { uid: "exclusion-owner", getIdToken: async () => "token" };
  let state = await store.list(f.owner);
  const fetcher = jest.spyOn(global, "fetch").mockImplementation(async () => ({ ok: true, status: 200, json: async () => state }) as Response);
  expect((await styleMemoryRequest(client)).boards[0]).not.toHaveProperty("exclusionSets");
  const input = command(f, { outfitItemIds: [[...f.members].reverse()] });
  state = (await store.mutate(f.owner, input)).state;
  expect(findExclusionSet(await styleMemoryRequest(client), f.scope)?.entries).toHaveLength(1);
  state.boards[0].exclusionSets![0].entries[0].itemIds.reverse();
  await expect(styleMemoryRequest(client)).rejects.toMatchObject({ uncertain: false });
  fetcher.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ state, operation: { id: input.operationId, revision: 3 } }) }) as Response);
  await expect(styleMemoryRequest(client, input)).rejects.toMatchObject({ uncertain: true });
});
