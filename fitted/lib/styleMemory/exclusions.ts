import { createHash } from "crypto";
import { findExclusionSet, type Board, type ExclusionScopeSelection, type SavedExclusionEntry, type SavedExclusionSet, type SetExclusionsCommand } from "./contract";
import { StyleMemoryError } from "./validation";

export const MAX_EXCLUSION_SETS = 128;
const scopeTuple = (scope: ExclusionScopeSelection) => [scope.boardId, scope.profileId, scope.profileVersion, scope.routineId, scope.routineVersion];
const identity = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
/** Server-only semantic identities. Browser lookup uses explicit stored scope fields. */
export function exclusionSetId(scope: ExclusionScopeSelection): string { return identity(scopeTuple(scope)); }
export function exclusionEntryId(scope: ExclusionScopeSelection, kind: SavedExclusionEntry["kind"], itemIds: readonly string[]): string {
  return identity([scopeTuple(scope), kind, [...itemIds].sort()]);
}

/** An empty set retains its revision; restoring a removed rule retains its semantic ID. */
export function buildExclusionSet(board: Board, command: SetExclusionsCommand, revision: number): SavedExclusionSet {
  const scope = { boardId: board.id, profileId: board.profileId, profileVersion: command.profileVersion,
    routineId: command.routineId, routineVersion: command.routineVersion };
  const previous = findExclusionSet(board, scope);
  if ((previous?.revision ?? 0) !== command.expectedSetRevision) throw new StyleMemoryError(409, "exclusion_revision_conflict", "These exclusions changed. Refresh before saving again.");
  if (!previous && (board.exclusionSets?.length ?? 0) >= MAX_EXCLUSION_SETS) throw new StyleMemoryError(429, "exclusion_scope_limit", "This direction has reached its saved exclusion scope limit. Existing exclusions can still be changed or removed.");
  const priorEntries = new Map(previous?.entries.map(entry => [entry.id, entry]) ?? []);
  const makeEntry = (kind: SavedExclusionEntry["kind"], members: string[]): SavedExclusionEntry => {
    const itemIds = [...members].sort(), id = exclusionEntryId(scope, kind, itemIds);
    return { id, revision: priorEntries.get(id)?.revision ?? revision, kind, itemIds };
  };
  const entries = [
    ...command.itemIds.map(id => makeEntry("item", [id])),
    ...command.outfitItemIds.map(members => makeEntry("combination", members)),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return { id: exclusionSetId(scope), revision, profileVersion: scope.profileVersion, routineId: scope.routineId, routineVersion: scope.routineVersion, entries };
}
