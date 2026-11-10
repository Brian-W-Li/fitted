import type { StyleMemoryData, StyleContextSelection } from "./contract";
import { StyleMemoryError } from "./validation";
export function contextIsVisible(data: StyleMemoryData, context?: Partial<StyleContextSelection> | null): boolean {
  if (!context) return true; // legacy snapshots have no fabricated context
  if (!context.boardId || !context.profileId || !Number.isSafeInteger(context.profileVersion)) return false;
  const b = data.boards.find(row => row.id === context.boardId && row.profileId === context.profileId);
  if (!b || data.tombstones.some(row => row.kind === "board" && (row.id === context.boardId || row.profileId === context.profileId)) || !b.versions.some(row => row.version === context.profileVersion)) return false;
  if (context.routineId == null) return context.routineVersion == null;
  const r = data.routines.find(row => row.id === context.routineId);
  return !!r && !data.tombstones.some(row => row.kind === "routine" && row.id === context.routineId) && r.versions.some(row => row.version === context.routineVersion);
}
export function resolveOwnedStyleContext(data: StyleMemoryData, revision: number, selection: StyleContextSelection,
  options: { allowArchived?: boolean; allowHistoricalVersions?: boolean } = {}) {
  if (!contextIsVisible(data, selection)) throw new StyleMemoryError(404, "context_unavailable", "That saved styling context is no longer available.");
  const b = data.boards.find(row => row.id === selection.boardId)!;
  const r = selection.routineId === null ? null : data.routines.find(row => row.id === selection.routineId)!;
  if (!options.allowArchived && (b.status !== "active" || r?.status === "archived")) throw new StyleMemoryError(409, "context_archived", "Restore this direction or situation before making another outfit.");
  if (!options.allowHistoricalVersions && (b.currentVersion !== selection.profileVersion || (r && r.currentVersion !== selection.routineVersion))) throw new StyleMemoryError(409, "version_conflict", "The saved direction or situation changed. Refresh before requesting outfits.");
  const profile = b.versions.find(row => row.version === selection.profileVersion)!;
  const enabled = !!r && b.learningOptIns.some(row => row.profileVersion === selection.profileVersion && row.routineId === r.id && row.routineVersion === selection.routineVersion && row.enabled);
  if (selection.learningEnabled !== enabled) throw new StyleMemoryError(409, "learning_changed", "The learning setting changed. Refresh before requesting outfits.");
  // A semantic edit must not relabel inherited old feedback as the new situation.
  // Cosmetic names apply to the current meaning; historical meaning stays frozen.
  const routineLabel = !r ? null : r.currentVersion === selection.routineVersion
    ? r.label : r.versions.find(version => version.version === selection.routineVersion)!.label;
  return { ...selection, boardLabel: b.label, routineLabel, memoryRevision: revision, compiled: structuredClone(profile.compiled) };
}
