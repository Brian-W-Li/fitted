import { isValidRequestId } from "@/lib/formats";
import type { CompiledStyleProfile, StyleMemoryCommand } from "./contract";
export class StyleMemoryError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export function invalid(message: string): never { throw new StyleMemoryError(400, "invalid_command", message); }
export function styleId(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value)) invalid("Choose a valid saved direction or situation."); return value; }
function text(value: unknown, max: number, blank = false): string { if (typeof value !== "string" || value.length > max || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || (!blank && !value.trim())) invalid(`Use ${max} or fewer characters without control characters.`); return value.trim(); }
function array(value: unknown, max: number): string[] { if (!Array.isArray(value) || value.length > max) invalid(`Choose at most ${max} terms.`); return [...new Set(value.map(term => text(term, 60)))]; }
export function compiledProfile(raw: unknown): CompiledStyleProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("Review the style summary before saving.");
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(key => !["aestheticKeywords", "palette", "patterns", "fits"].includes(key))) invalid("Unsupported style summary field.");
  return { aestheticKeywords: array(r.aestheticKeywords, 12), palette: array(r.palette, 12), patterns: array(r.patterns, 12), fits: array(r.fits, 12) };
}
const fields: Record<string, string[]> = {
  create_board: ["id", "profileId", "label", "rawSource", "compiled"], edit_board: ["boardId", "rawSource", "compiled"], rename_board: ["boardId", "label"],
  archive_board: ["boardId"], restore_board: ["boardId"], erase_board: ["boardId"], create_routine: ["id", "label"], edit_routine: ["routineId", "label"], rename_routine: ["routineId", "label"],
  archive_routine: ["routineId"], restore_routine: ["routineId"], erase_routine: ["routineId"], select_context: ["boardId", "routineId"], set_default_routine: ["boardId", "routineId"],
  set_learning: ["boardId", "profileVersion", "routineId", "routineVersion", "enabled"],
};
export function parseStyleMemoryCommand(raw: unknown): StyleMemoryCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("Expected a styling command.");
  const r = raw as Record<string, unknown>, kind = r.kind;
  if (typeof kind !== "string" || !Object.hasOwn(fields, kind)) invalid("Unsupported styling command.");
  const allowed = ["kind", "operationId", "expectedRevision", ...fields[kind]];
  if (Object.keys(r).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(r, key))) invalid("The styling command contains missing or unsupported fields.");
  if (typeof r.operationId !== "string" || r.operationId.length > 64 || !isValidRequestId(r.operationId)) invalid("A stable operation ID is required.");
  if (!Number.isSafeInteger(r.expectedRevision) || (r.expectedRevision as number) < 0) invalid("Refresh the saved styling state before changing it.");
  const result: Record<string, unknown> = { kind, operationId: r.operationId.includes("-") ? r.operationId.toLowerCase() : r.operationId, expectedRevision: r.expectedRevision };
  for (const key of fields[kind]) {
    const value = r[key];
    if (["id", "profileId", "boardId", "routineId"].includes(key)) {
      const nullable = key === "routineId" && ["select_context", "set_default_routine"].includes(kind) || key === "boardId" && kind === "select_context";
      result[key] = nullable && value === null ? null : styleId(value);
    } else if (key === "label") result[key] = text(value, 60);
    else if (key === "rawSource") result[key] = text(value, 500, true);
    else if (key === "compiled") result[key] = compiledProfile(value);
    else if (key === "enabled") { if (typeof value !== "boolean") invalid("Choose whether learning is enabled."); result[key] = value; }
    else { if (!Number.isSafeInteger(value) || (value as number) < 1) invalid("Choose a valid semantic version."); result[key] = value; }
  }
  return result as unknown as StyleMemoryCommand;
}
