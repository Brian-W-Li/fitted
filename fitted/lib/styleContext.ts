/** Captured style is a request input, never a label reconstructed from today's settings. */
export interface CompiledStyleProfile {
  aestheticKeywords: string[];
  palette: string[];
  patterns: string[];
  fits: string[];
}

export interface StyleSelection {
  boardId: string;
  profileId: string;
  profileVersion: number;
  routineId: string | null;
  routineVersion: number | null;
  learningEnabled: boolean;
}

export interface CapturedStyleContext extends StyleSelection {
  routineId: string | null;
  routineVersion: number | null;
  boardLabel: string;
  routineLabel: string | null;
  compiled: CompiledStyleProfile;
  memoryRevision: number;
  weather: "cold" | "mild" | "hot" | "unspecified";
}

const HEX_ID = /^[a-f0-9]{24}$/;
const positiveVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseStyleSelection(value: unknown): StyleSelection | null {
  if (!object(value)) return null;
  const keys = new Set(["boardId", "profileId", "profileVersion", "routineId", "routineVersion", "learningEnabled"]);
  if (Object.keys(value).some(key => !keys.has(key)) || typeof value.boardId !== "string" || !HEX_ID.test(value.boardId) ||
    typeof value.profileId !== "string" || !HEX_ID.test(value.profileId) || !positiveVersion(value.profileVersion) ||
    typeof value.learningEnabled !== "boolean") return null;
  const routineId = value.routineId ?? null;
  const routineVersion = value.routineVersion ?? null;
  if ((routineId === null) !== (routineVersion === null) || (routineId !== null &&
    (typeof routineId !== "string" || !HEX_ID.test(routineId) || !positiveVersion(routineVersion)))) return null;
  if (value.learningEnabled && routineId === null) return null;
  return { boardId: value.boardId, profileId: value.profileId, profileVersion: value.profileVersion,
    routineId: routineId as string | null, routineVersion: routineVersion as number | null, learningEnabled: value.learningEnabled };
}

export function styleSelectionFromSnapshot(value: unknown): StyleSelection | null {
  if (!object(value)) return null;
  return parseStyleSelection({ boardId: value.boardId, profileId: value.profileId, profileVersion: value.profileVersion,
    routineId: value.routineId ?? null, routineVersion: value.routineVersion ?? null, learningEnabled: value.learningEnabled });
}

/** Cosmetic labels and current memory revision are excluded from command equality. */
export function styleSelectionKey(value: unknown): string | null {
  const selected = styleSelectionFromSnapshot(value);
  return selected ? JSON.stringify([selected.boardId, selected.profileId, selected.profileVersion,
    selected.routineId, selected.routineVersion, selected.learningEnabled]) : null;
}

export function sameStyleSelection(left: unknown, right: unknown): boolean {
  return styleSelectionKey(left) === styleSelectionKey(right);
}

const CAPTURED_FIELDS = ["boardId", "profileId", "profileVersion", "routineId", "routineVersion", "learningEnabled",
  "boardLabel", "routineLabel", "compiled", "memoryRevision", "weather"];
const COMPILED_FIELDS = ["aestheticKeywords", "palette", "patterns", "fits"];
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validLabel = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 60 && value.isWellFormed();

export function validCapturedStyleContext(value: unknown): value is CapturedStyleContext {
  if (!object(value) || !exactKeys(value, CAPTURED_FIELDS) || !styleSelectionFromSnapshot(value) ||
    !object(value.compiled) || !exactKeys(value.compiled, COMPILED_FIELDS) || !validLabel(value.boardLabel) ||
    (value.routineId === null ? value.routineLabel !== null : !validLabel(value.routineLabel)) ||
    !Number.isSafeInteger(value.memoryRevision) || Number(value.memoryRevision) < 0 ||
    typeof value.weather !== "string" || !["cold", "mild", "hot", "unspecified"].includes(value.weather)) return false;
  return COMPILED_FIELDS.every(key => {
    const list = (value.compiled as Record<string, unknown>)[key];
    return Array.isArray(list) && list.length <= 12 && list.every(validLabel);
  });
}

export function sameCapturedStyleContext(left: unknown, right: unknown): boolean {
  if (!validCapturedStyleContext(left) || !validCapturedStyleContext(right) || !sameStyleSelection(left, right)) return false;
  return left.boardLabel === right.boardLabel && left.routineLabel === right.routineLabel &&
    left.memoryRevision === right.memoryRevision && left.weather === right.weather &&
    (["aestheticKeywords", "palette", "patterns", "fits"] as const).every(key =>
      JSON.stringify(left.compiled[key]) === JSON.stringify(right.compiled[key]));
}
