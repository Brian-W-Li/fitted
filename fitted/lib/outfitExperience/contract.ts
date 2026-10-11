import { isValidRequestId, OBJECT_ID_RE } from "@/lib/formats";
import { validateWearDate, type WearDate } from "./date";
import { userWearContext, type WearContext } from "./context";
import { ExperienceValidationError } from "./errors";

export const MAX_EXPERIENCE_REVISIONS = 32; // Retraction has a separate final slot.
export const EXPERIENCE_PAGE_SIZE = 20;
export const EXPERIENCE_SCAN_SIZE = 100;
export type Outcome = "worked" | "change_next_time" | "unknown";
export interface ActualItem { itemId: string; name: string; clothingType: string }
export type ContextInput = { kind: "user"; text: string } | { kind: "suggestion"; confirmed: boolean };
export interface WearState extends WearDate {
  context: WearContext;
  outcome: Outcome;
  compositionStatus: "as_shown" | "changed";
  /** Captured at the report/revision, so later closet edits cannot rewrite what was worn. */
  memberItems?: ActualItem[];
  learningDisposition: "do_not_learn";
}
export interface WearInput extends WearDate {
  context: ContextInput;
  outcome: Outcome;
  compositionStatus: "as_shown" | "changed";
  memberItemIds?: string[];
}
export interface CreateInput extends WearInput {
  experienceId: string; operationId: string; snapshotId: string; candidateId: string;
}
export interface EditInput extends WearInput {
  operationId: string; expectedPreviousRevision: number;
}

function invalid(message: string): never { throw new ExperienceValidationError("request", message); }
export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("Expected an object");
  return raw as Record<string, unknown>;
}
export function exactKeys(raw: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(raw).some(k => !keys.includes(k))) invalid("Unexpected request field");
}
export function operationId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 64 || !isValidRequestId(raw)) invalid("Invalid operation or experience ID");
  return raw.includes("-") ? raw.toLowerCase() : raw;
}
export function objectId(raw: unknown): string {
  if (typeof raw !== "string" || !OBJECT_ID_RE.test(raw)) invalid("Invalid owner, snapshot or item ID");
  return raw.toLowerCase();
}
export function previousRevision(raw: unknown): number {
  if (!Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > MAX_EXPERIENCE_REVISIONS) invalid("Invalid previous revision");
  return raw as number;
}
const WEAR_KEYS = ["occurredOn", "timezone", "context", "outcome", "compositionStatus", "memberItemIds"];
function wear(raw: Record<string, unknown>, now: Date): WearInput {
  const date = validateWearDate(raw.occurredOn, raw.timezone, now);
  if (raw.compositionStatus !== "as_shown" && raw.compositionStatus !== "changed") invalid("Invalid actual outfit composition");
  let memberItemIds: string[] | undefined;
  if (raw.compositionStatus === "changed") {
    if (!Array.isArray(raw.memberItemIds) || raw.memberItemIds.length < 1 || raw.memberItemIds.length > 5) invalid("Choose 1–5 actual pieces");
    memberItemIds = raw.memberItemIds.map(objectId);
    if (new Set(memberItemIds).size !== memberItemIds.length) invalid("Actual pieces must be unique");
  } else if (raw.memberItemIds !== undefined) invalid("Shown composition is derived from the source");
  const outcome = raw.outcome ?? "unknown";
  if (!["worked", "change_next_time", "unknown"].includes(outcome as string)) invalid("Invalid outcome");
  const c = object(raw.context);
  let context: ContextInput;
  if (c.kind === "user") {
    exactKeys(c, ["kind", "text"]);
    context = { kind: "user", text: userWearContext(c.text).rawOccasion };
  } else if (c.kind === "suggestion" && typeof c.confirmed === "boolean") {
    exactKeys(c, ["kind", "confirmed"]);
    context = { kind: "suggestion", confirmed: c.confirmed };
  } else invalid("Invalid actual-wear context");
  return { ...date, context, outcome: outcome as Outcome,
    compositionStatus: raw.compositionStatus, ...(memberItemIds ? { memberItemIds } : {}) };
}
export function createInput(raw: unknown, now: Date): CreateInput {
  const r = object(raw);
  exactKeys(r, [...WEAR_KEYS, "experienceId", "operationId", "snapshotId", "candidateId"]);
  if (typeof r.candidateId !== "string" || !r.candidateId.length || r.candidateId.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(r.candidateId)) invalid("Invalid candidate ID");
  return { ...wear(r, now), experienceId: operationId(r.experienceId), operationId: operationId(r.operationId), snapshotId: objectId(r.snapshotId), candidateId: r.candidateId };
}
export function editInput(raw: unknown, now: Date): EditInput {
  const r = object(raw);
  exactKeys(r, [...WEAR_KEYS, "operationId", "expectedPreviousRevision"]);
  return { ...wear(r, now), operationId: operationId(r.operationId), expectedPreviousRevision: previousRevision(r.expectedPreviousRevision) };
}
export function retractInput(raw: unknown) {
  const r = object(raw);
  exactKeys(r, ["operationId", "expectedPreviousRevision"]);
  return { operationId: operationId(r.operationId), expectedPreviousRevision: previousRevision(r.expectedPreviousRevision) };
}
