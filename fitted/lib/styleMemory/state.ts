import type { Board, Routine, StyleMemoryCommand, StyleMemoryData, StyleMemoryState } from "./contract";
import { StyleMemoryError } from "./validation";
export const STYLE_MEMORY_RECEIPTS = 2048;
export const STYLE_MEMORY_NORMAL_RECEIPTS = STYLE_MEMORY_RECEIPTS - 64;
export const STYLE_MEMORY_MAX_BYTES = 2 * 1024 * 1024;
function fail(status: number, code: string, message: string): never { throw new StyleMemoryError(status, code, message); }
export function publicStyleMemory(data: StyleMemoryData, revision: number): StyleMemoryState { return { revision, boards: data.boards, routines: data.routines, selectedBoardId: data.selectedBoardId, selectedRoutineId: data.selectedRoutineId }; }
function board(data: StyleMemoryData, id: string): Board { const found = data.boards.find(row => row.id === id); if (!found) fail(404, "board_unavailable", "That direction is no longer available."); return found; }
function routine(data: StyleMemoryData, id: string): Routine { const found = data.routines.find(row => row.id === id); if (!found) fail(404, "routine_unavailable", "That situation is no longer available."); return found; }
function active(value: Board | Routine) { if (value.status !== "active") fail(409, "context_archived", "Restore this direction or situation before using it."); }
function unused(data: StyleMemoryData, ...ids: string[]) {
  const known = new Set([...data.boards.flatMap(row => [row.id, row.profileId]), ...data.routines.map(row => row.id), ...data.tombstones.flatMap(row => [row.id, ...(row.profileId ? [row.profileId] : [])])]);
  if (new Set(ids).size !== ids.length || ids.some(id => known.has(id))) fail(409, "identity_conflict", "This saved identity has already been used. Refresh before creating another.");
}
function capacity(data: StyleMemoryData, kind: "board" | "routine") {
  const rows = kind === "board" ? data.boards : data.routines, limit = kind === "board" ? 8 : 16;
  if (rows.filter(row => row.status === "active").length >= limit) fail(429, "active_limit", `Archive a ${kind === "board" ? "direction" : "situation"} before adding another.`);
  if (rows.length + data.tombstones.filter(row => row.kind === kind).length >= 32) fail(429, "identity_limit", "Saved styling identity storage is full. Existing entries can still be corrected or erased.");
}
/** Pure state transition; validation is server-owned and data remains bounded. */
export function applyStyleCommand(data: StyleMemoryData, c: StyleMemoryCommand, revision: number, createdAt: string): void {
  switch (c.kind) {
    case "create_board": unused(data, c.id, c.profileId); capacity(data, "board"); data.boards.push({ id: c.id, profileId: c.profileId, label: c.label, status: "active", currentVersion: 1, versions: [{ version: 1, createdAt, rawSource: c.rawSource, compiled: c.compiled }], learningOptIns: [], defaultRoutineId: null }); break;
    case "edit_board": { const b = board(data, c.boardId); active(b); if (b.versions.length >= 16) fail(429, "version_limit", "This direction has reached its version limit. Keep it or create a new direction."); b.currentVersion++; b.versions.push({ version: b.currentVersion, createdAt, rawSource: c.rawSource, compiled: c.compiled }); break; }
    case "rename_board": board(data, c.boardId).label = c.label; break;
    case "archive_board": { const b = board(data, c.boardId); b.status = "archived"; if (data.selectedBoardId === b.id) { data.selectedBoardId = null; data.selectedRoutineId = null; } break; }
    case "restore_board": { const b = board(data, c.boardId); if (b.status === "archived" && data.boards.filter(row => row.status === "active").length >= 8) fail(429, "active_limit", "Archive another direction first."); b.status = "active"; break; }
    case "erase_board": { const b = board(data, c.boardId); data.tombstones.push({ kind: "board", id: b.id, profileId: b.profileId, revision }); data.boards = data.boards.filter(row => row.id !== b.id); if (data.selectedBoardId === b.id) { data.selectedBoardId = null; data.selectedRoutineId = null; } break; }
    case "create_routine": unused(data, c.id); capacity(data, "routine"); data.routines.push({ id: c.id, label: c.label, status: "active", currentVersion: 1, versions: [{ version: 1, createdAt, label: c.label }] }); break;
    case "edit_routine": { const r = routine(data, c.routineId); active(r); if (r.versions.length >= 8) fail(429, "version_limit", "This situation has reached its version limit. Keep it or create a new one."); r.currentVersion++; r.label = c.label; r.versions.push({ version: r.currentVersion, createdAt, label: c.label }); break; }
    case "rename_routine": routine(data, c.routineId).label = c.label; break;
    case "archive_routine": { routine(data, c.routineId).status = "archived"; if (data.selectedRoutineId === c.routineId) data.selectedRoutineId = null; break; }
    case "restore_routine": { const r = routine(data, c.routineId); if (r.status === "archived" && data.routines.filter(row => row.status === "active").length >= 16) fail(429, "active_limit", "Archive another situation first."); r.status = "active"; break; }
    case "erase_routine": { const r = routine(data, c.routineId); data.tombstones.push({ kind: "routine", id: r.id, revision }); data.routines = data.routines.filter(row => row.id !== r.id); for (const b of data.boards) { b.learningOptIns = b.learningOptIns.filter(row => row.routineId !== r.id); if (b.defaultRoutineId === r.id) b.defaultRoutineId = null; } if (data.selectedRoutineId === r.id) data.selectedRoutineId = null; break; }
    case "select_context": if (c.boardId === null) { if (c.routineId !== null) fail(400, "context_invalid", "Choose a direction before a saved situation."); } else active(board(data, c.boardId)); if (c.routineId !== null) active(routine(data, c.routineId)); data.selectedBoardId = c.boardId; data.selectedRoutineId = c.routineId; break;
    case "set_default_routine": { const b = board(data, c.boardId); active(b); if (c.routineId !== null) active(routine(data, c.routineId)); b.defaultRoutineId = c.routineId; break; }
    case "set_learning": { const b = board(data, c.boardId), r = routine(data, c.routineId); active(b); active(r); if (b.currentVersion !== c.profileVersion || r.currentVersion !== c.routineVersion) fail(409, "version_conflict", "The direction or situation changed. Refresh before changing learning."); const existing = b.learningOptIns.find(row => row.profileVersion === c.profileVersion && row.routineId === c.routineId && row.routineVersion === c.routineVersion); if (existing) existing.enabled = c.enabled; else { if (b.learningOptIns.length >= 128) fail(429, "opt_in_limit", "This direction has reached its learning-context limit."); b.learningOptIns.push({ profileVersion: c.profileVersion, routineId: c.routineId, routineVersion: c.routineVersion, enabled: c.enabled }); } break; }
  }
}
