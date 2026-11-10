import { randomUUID } from "crypto";
import { Types } from "mongoose";
import type { NextRequest } from "next/server";
import User from "@/models/User";
import OutfitInteraction from "@/models/OutfitInteraction";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import type { CapturedStyleContext } from "@/lib/styleContext";
import type { StyleContextSelection } from "@/lib/styleMemory/contract";
import { postInteraction, type InteractionDeps } from "@/lib/interactions";
import { makeSnapshot, seedUser } from "./interactionFixture";
export const oid = () => new Types.ObjectId().toHexString();
export const request = (body: Record<string, unknown>) => ({ json: async () => body, headers: { get: () => "Bearer fixture" } }) as unknown as NextRequest;
export const deps = (owner: string): InteractionDeps => ({ verifyUser: async () => ({ userId: owner }), models: { User, OutfitInteraction, GenerationSnapshot } });
export async function namedOwner() {
  const owner = oid(); await seedUser(owner);
  const context: CapturedStyleContext = { boardId: oid(), profileId: oid(), profileVersion: 1, routineId: oid(), routineVersion: 1,
    learningEnabled: true, boardLabel: "Campus", routineLabel: "Class", compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] }, memoryRevision: 0, weather: "mild" };
  const selection: StyleContextSelection = { boardId: context.boardId, profileId: context.profileId, profileVersion: 1, routineId: context.routineId, routineVersion: 1, learningEnabled: true };
  await User.updateOne({ _id: owner }, { $set: { styleMemoryRevision: 0, styleMemory: { boards: [{ id: context.boardId, profileId: context.profileId, label: "Campus", status: "active", currentVersion: 1,
    versions: [{ version: 1, createdAt: new Date().toISOString(), rawSource: "relaxed", compiled: context.compiled }],
    learningOptIns: [{ profileVersion: 1, routineId: context.routineId, routineVersion: 1, enabled: true }], defaultRoutineId: null }],
    routines: [{ id: context.routineId, label: "Class", status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: new Date().toISOString(), label: "Class" }] }],
    selectedBoardId: context.boardId, selectedRoutineId: context.routineId, tombstones: [], operations: [] } } });
  return { owner, context, selection };
}
export async function styledSnapshot(owner: string, context: CapturedStyleContext, itemIds?: [string, string]) {
  const binding = await makeSnapshot(owner, { itemIds });
  await GenerationSnapshot.collection.updateOne({ _id: new Types.ObjectId(binding.snapshotId) }, { $set: { requestId: randomUUID(), styleContext: context,
    "itemSnapshots.0.engineVisible.subtype": "t_shirt", "itemSnapshots.0.engineVisible.pattern": "solid", "itemSnapshots.0.engineVisible.fit": "relaxed",
    "itemSnapshots.1.engineVisible.subtype": "jeans", "itemSnapshots.1.engineVisible.pattern": "solid", "itemSnapshots.1.engineVisible.fit": "slim" } });
  return binding;
}
export async function react(owner: string, binding: { snapshotId: string; candidateId: string }, action: "accepted" | "rejected" = "accepted") {
  const result = await postInteraction(request({ snapshotId: binding.snapshotId, candidateId: binding.candidateId, action }), deps(owner));
  if (result.status !== 200) throw new Error(`Fixture reaction failed: ${await result.text()}`);
  return (await result.json()).interaction.id as string;
}
