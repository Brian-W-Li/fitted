import type { WeatherSource, WeatherSignals, LayerChoice } from "@/lib/weatherContext";
import { snapshotVisible } from "@/lib/snapshotVisibility";
import { Types } from "mongoose";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { objectId } from "./contract";
import { ExperienceError } from "./errors";

export interface SourceCandidate {
  candidateId: string;
  items: { itemId: string; role?: string }[];
  styleMove?: { oneSentence?: string };
}
export interface MemorySnapshot {
  variationSourceExperienceId?: string;
  variationSourceRevision?: number;
  _id: Types.ObjectId;
  user: Types.ObjectId;
  occasion?: string;
  weather?: string;
  weatherRaw?: string | null;
  weatherSource?: WeatherSource;
  weatherSignals?: WeatherSignals;
  layerChoice?: LayerChoice;
  redacted?: boolean;
  shownCandidateIds: string[];
  candidates: SourceCandidate[];
  itemSnapshots: { itemId: string; engineVisible?: { name?: string; clothingType?: string; imageUrl?: string } }[];
}
export const SOURCE_PROJECTION = { user: 1, variationSourceExperienceId: 1, variationSourceRevision: 1, occasion: 1, weather: 1, weatherRaw: 1, weatherSource: 1, weatherSignals: 1, layerChoice: 1, redacted: 1, shownCandidateIds: 1, "candidates.candidateId": 1, "candidates.items": 1, "candidates.styleMove.oneSentence": 1, "itemSnapshots.itemId": 1, "itemSnapshots.engineVisible.name": 1, "itemSnapshots.engineVisible.clothingType": 1, "itemSnapshots.engineVisible.imageUrl": 1 };

export async function visibleSnapshot(user: Types.ObjectId, snapshotId: Types.ObjectId): Promise<MemorySnapshot | null> {
  const row = await GenerationSnapshot.collection.findOne({ _id: snapshotId, user, redacted: { $ne: true } }, { projection: SOURCE_PROJECTION }) as MemorySnapshot | null;
  return row && await snapshotVisible(user, row) ? row : null;
}
export function shownCandidate(source: MemorySnapshot, candidateId: string): SourceCandidate | null {
  if (!source.shownCandidateIds.includes(candidateId)) return null;
  return source.candidates.find(c => c.candidateId === candidateId) ?? null;
}
export async function requireSource(user: Types.ObjectId, snapshotId: string, candidateId: string) {
  const snapshot = await visibleSnapshot(user, new Types.ObjectId(snapshotId));
  const candidate = snapshot && shownCandidate(snapshot, candidateId);
  if (!snapshot || !candidate || !candidate.items.length) throw new ExperienceError(404, "source_unavailable");
  return { snapshot, memberItemIds: [...new Set(candidate.items.map(i => objectId(i.itemId)))].map(id => new Types.ObjectId(id)) };
}
