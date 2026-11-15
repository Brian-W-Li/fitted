import type { StyleMemoryCommand, StyleMemoryResult, StyleMemoryState } from "./contract";

export interface StyleMemoryUser { uid: string; getIdToken(): Promise<string> }
export class StyleMemoryRequestError extends Error {
  constructor(message: string, public status: number | null = null, public uncertain = false) { super(message); }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown) => Array.isArray(value) && value.every(entry => typeof entry === "string");
const id = (value: unknown) => typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
const positive = (value: unknown) => integer(value) && (value as number) > 0;
function canonicalMembers(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length >= 1 && value.length <= max && value.every(id) &&
    value.every((member, index) => index === 0 || value[index - 1] < member);
}
function exclusionSets(value: unknown, versions: unknown): boolean {
  if (value === undefined) return true; // Boards created before exclusions remain readable.
  if (!Array.isArray(value) || value.length > 128 || !Array.isArray(versions)) return false;
  const scopes = new Set<string>(), setIds = new Set<string>();
  return value.every(set => {
    if (!record(set) || !id(set.id) || !positive(set.revision) || !positive(set.profileVersion) ||
      !versions.some(version => record(version) && version.version === set.profileVersion) ||
      !((set.routineId === null && set.routineVersion === null) || (id(set.routineId) && positive(set.routineVersion))) ||
      !Array.isArray(set.entries) || set.entries.length > 40) return false;
    const scope = JSON.stringify([set.profileVersion, set.routineId, set.routineVersion]);
    if (scopes.has(scope) || setIds.has(set.id as string)) return false;
    scopes.add(scope); setIds.add(set.id as string);
    const entries = new Set<string>(); let items = 0, combinations = 0;
    return set.entries.every(entry => {
      if (!record(entry) || !id(entry.id) || !positive(entry.revision) || (entry.revision as number) > (set.revision as number) ||
        !["item", "combination"].includes(entry.kind as string) || !canonicalMembers(entry.itemIds, entry.kind === "item" ? 1 : 5) ||
        entries.has(entry.id as string)) return false;
      entries.add(entry.id as string);
      if (entry.kind === "item") items++; else combinations++;
      return items <= 20 && combinations <= 20;
    });
  });
}
function isState(value: unknown): value is StyleMemoryState {
  if (!record(value) || !integer(value.revision) || !Array.isArray(value.boards) || !Array.isArray(value.routines) ||
    !(value.selectedBoardId === null || id(value.selectedBoardId)) || !(value.selectedRoutineId === null || id(value.selectedRoutineId))) return false;
  return value.boards.every(board => record(board) && id(board.id) && id(board.profileId) && typeof board.label === "string" &&
    ["active", "archived"].includes(board.status as string) && integer(board.currentVersion) && Array.isArray(board.versions) &&
    board.versions.some(version => record(version) && version.version === board.currentVersion) &&
    board.versions.every(version => record(version) && integer(version.version) && typeof version.createdAt === "string" && typeof version.rawSource === "string" &&
      record(version.compiled) && ["aestheticKeywords", "palette", "patterns", "fits"].every(key => strings((version.compiled as Record<string, unknown>)[key]))) &&
    Array.isArray(board.learningOptIns) && board.learningOptIns.every(opt => record(opt) && integer(opt.profileVersion) && id(opt.routineId) && integer(opt.routineVersion) && typeof opt.enabled === "boolean") &&
    exclusionSets(board.exclusionSets, board.versions)) &&
    value.routines.every(routine => record(routine) && id(routine.id) && typeof routine.label === "string" && ["active", "archived"].includes(routine.status as string) &&
      integer(routine.currentVersion) && Array.isArray(routine.versions) && routine.versions.some(version => record(version) && version.version === routine.currentVersion) &&
      routine.versions.every(version => record(version) && integer(version.version) && typeof version.createdAt === "string" && typeof version.label === "string"));
}

/** Uncertain writes retain their exact command in the caller; this helper never retries. */
export async function styleMemoryRequest(user: StyleMemoryUser, command?: StyleMemoryCommand, signal?: AbortSignal): Promise<StyleMemoryState> {
  let response: Response;
  try {
    const token = await user.getIdToken();
    if (signal?.aborted) throw new Error("Request cancelled");
    response = await fetch("/api/style-memory", { method: command ? "POST" : "GET", signal,
      headers: { Authorization: `Bearer ${token}`, ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify(command) } : {}) });
  } catch {
    throw new StyleMemoryRequestError(command ? "We couldn't confirm that change. Retry the same change to check safely." : "Couldn't load saved directions. Try again.", null, !!command);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const message = record(body) && typeof body.error === "string" ? body.error : "Couldn't save that change. Try again.";
    throw new StyleMemoryRequestError(message, response.status, !!command && response.status >= 500);
  }
  if (!command && isState(body)) return body;
  const result = body as StyleMemoryResult | null;
  if (command && record(body) && isState(body.state) && record(body.operation) && body.operation.id === command.operationId && integer(body.operation.revision) &&
    (body.operation.revision as number) <= body.state.revision) return result!.state;
  throw new StyleMemoryRequestError(command ? "The change may have saved, but its confirmation was incomplete. Retry the same change." : "Saved directions returned an incomplete response. Try again.", response.status, !!command);
}
