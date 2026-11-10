/** Browser-safe contract. A Board declares intent; reactions remain separate evidence. */
export interface CompiledStyleProfile { aestheticKeywords: string[]; palette: string[]; patterns: string[]; fits: string[] }
export interface StyleProfileVersion { version: number; createdAt: string; rawSource: string; compiled: CompiledStyleProfile }
export interface LearningOptIn { profileVersion: number; routineId: string; routineVersion: number; enabled: boolean }
export interface Board { id: string; label: string; status: "active" | "archived"; profileId: string; currentVersion: number; versions: StyleProfileVersion[]; learningOptIns: LearningOptIn[]; defaultRoutineId?: string | null }
export interface Routine { id: string; label: string; status: "active" | "archived"; currentVersion: number; versions: { version: number; createdAt: string; label: string }[] }
export interface StyleMemoryState { revision: number; boards: Board[]; routines: Routine[]; selectedBoardId: string | null; selectedRoutineId: string | null }
export interface StyleContextSelection { boardId: string; profileId: string; profileVersion: number; routineId: string | null; routineVersion: number | null; learningEnabled: boolean }
type Base = { operationId: string; expectedRevision: number };
type BoardTarget = { boardId: string };
type RoutineTarget = { routineId: string };
export type StyleMemoryCommand = Base & (
  | { kind: "create_board"; id: string; profileId: string; label: string; rawSource: string; compiled: CompiledStyleProfile }
  | ({ kind: "edit_board"; rawSource: string; compiled: CompiledStyleProfile } & BoardTarget)
  | ({ kind: "rename_board"; label: string } & BoardTarget)
  | ({ kind: "archive_board" | "restore_board" | "erase_board" } & BoardTarget)
  | { kind: "create_routine"; id: string; label: string }
  | ({ kind: "edit_routine" | "rename_routine"; label: string } & RoutineTarget)
  | ({ kind: "archive_routine" | "restore_routine" | "erase_routine" } & RoutineTarget)
  | { kind: "select_context"; boardId: string | null; routineId: string | null }
  | ({ kind: "set_default_routine"; routineId: string | null } & BoardTarget)
  | ({ kind: "set_learning"; profileVersion: number; routineId: string; routineVersion: number; enabled: boolean } & BoardTarget)
);
export interface StyleMemoryResult { state: StyleMemoryState; operation: { id: string; revision: number } }
export interface StyleTombstone { kind: "board" | "routine"; id: string; profileId?: string; revision: number }
export interface StyleMemoryData { boards: Board[]; routines: Routine[]; selectedBoardId: string | null; selectedRoutineId: string | null; tombstones: StyleTombstone[]; operations: { id: string; digest: string; revision: number }[] }
export const emptyStyleMemory = (): StyleMemoryData => ({ boards: [], routines: [], selectedBoardId: null, selectedRoutineId: null, tombstones: [], operations: [] });
/** Selection is derived from acknowledged state, never an inferred/default context. */
export function selectedStyleContext(state: StyleMemoryState): StyleContextSelection | null {
  const board = state.boards.find(row => row.id === state.selectedBoardId && row.status === "active");
  if (!board) return null;
  const routine = state.routines.find(row => row.id === state.selectedRoutineId && row.status === "active");
  return { boardId: board.id, profileId: board.profileId, profileVersion: board.currentVersion, routineId: routine?.id ?? null, routineVersion: routine?.currentVersion ?? null,
    learningEnabled: !!routine && board.learningOptIns.some(row => row.profileVersion === board.currentVersion && row.routineId === routine.id && row.routineVersion === routine.currentVersion && row.enabled) };
}
