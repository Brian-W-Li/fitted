/** Single-dimension context and acknowledgement boundaries, with real stored evidence. */
import { randomUUID } from "crypto";
import User from "@/models/User";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import OutfitInteraction from "@/models/OutfitInteraction";
import { buildStylePreferenceEvidence } from "@/lib/stylePreferenceEvidence";
import { StyleMemoryStore } from "@/lib/styleMemory/store";
import { styleMemoryRequest } from "@/lib/styleMemory/client";
import { __resetInteractionRateLimit } from "@/lib/interactions";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import { namedOwner, react, styledSnapshot } from "./helpers/styleLearningFixture";

let harness: MongoHarness;
beforeAll(async () => { harness = await startMemoryMongo([User, GenerationSnapshot, OutfitInteraction], { replicaSet: true }); }, 120_000);
afterEach(async () => { jest.restoreAllMocks(); __resetInteractionRateLimit(); await harness.clear(); });
afterAll(async () => { await harness.stop(); });

it("a situation-only semantic edit separates old preference and affinity while preserving historical evidence and exposure", async () => {
  const f = await namedOwner(), source = await styledSnapshot(f.owner, f.context);
  const reactionId = await react(f.owner, source);
  const original = await buildStylePreferenceEvidence(f.owner, f.selection, "mild");
  expect(original.preferenceRows.map(row => row.id)).toEqual([reactionId]);
  expect(original.interactionCountAtRequest).toBe(1);

  const store = new StyleMemoryStore();
  await store.mutate(f.owner, { kind: "edit_routine", operationId: randomUUID(), expectedRevision: 1,
    routineId: f.selection.routineId!, label: "Gym" });
  await store.mutate(f.owner, { kind: "set_learning", operationId: randomUUID(), expectedRevision: 2,
    boardId: f.selection.boardId, profileVersion: f.selection.profileVersion,
    routineId: f.selection.routineId!, routineVersion: 2, enabled: true });
  const next = await buildStylePreferenceEvidence(f.owner, { ...f.selection, routineVersion: 2 }, "mild");
  expect(next.styleContext).toMatchObject({ boardId: f.context.boardId, profileId: f.context.profileId,
    profileVersion: f.context.profileVersion, routineId: f.context.routineId, routineVersion: 2,
    routineLabel: "Gym", learningEnabled: true, compiled: f.context.compiled, weather: "mild", memoryRevision: 3 });
  expect(next.preferenceRows).toEqual([]);
  expect(next.interactionCountAtRequest).toBe(0);
  expect(next.behavioralRows.interactionRows).toEqual([]);
  expect(next.behavioralRows.recentSnapshots).toHaveLength(1);

  const historical = await buildStylePreferenceEvidence(f.owner, f.selection, "mild", { allowHistoricalVersions: true });
  expect(historical.preferenceRows.map(row => row.id)).toEqual([reactionId]);
  expect(historical.behavioralRows.interactionRows.map(row => row.snapshotId)).toEqual([source.snapshotId]);
  expect(await OutfitInteraction.countDocuments({ user: f.owner })).toBe(1);
});

it("keeps an otherwise valid wrong-operation acknowledgement uncertain until the exact same command is confirmed", async () => {
  const f = await namedOwner(), store = new StyleMemoryStore();
  const command = { kind: "rename_board" as const, boardId: f.selection.boardId, label: "Campus days",
    expectedRevision: 0, operationId: randomUUID() };
  const receipt = await store.mutate(f.owner, command);
  const fetcher = jest.spyOn(global, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, operation: { ...receipt.operation, id: randomUUID() } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 200 }));
  const client = { uid: "acknowledgement-owner", getIdToken: async () => "test-token" };
  await expect(styleMemoryRequest(client, command)).rejects.toMatchObject({ status: 200, uncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1); // No automatic retry or replacement operation.

  expect(await styleMemoryRequest(client, command)).toEqual(receipt.state);
  expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([command, command]);
  expect((await store.list(f.owner)).revision).toBe(1);
});
