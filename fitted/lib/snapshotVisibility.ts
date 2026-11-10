import { Types, type ClientSession } from "mongoose";
import { experienceCollection } from "@/models/OutfitExperience";
import { readStyleMemoryOwner } from "@/lib/styleMemory/store";
import { contextIsVisible } from "@/lib/styleMemory/context";
import { StyleMemoryError } from "@/lib/styleMemory/validation";
import type { StyleContextSelection, StyleMemoryData } from "@/lib/styleMemory/contract";

export interface SnapshotVisibility {
  redacted?: boolean;
  styleContext?: Partial<StyleContextSelection> | null;
  variationSourceExperienceId?: string | null;
  variationSourceRevision?: number | null;
}
function unbound(row: SnapshotVisibility) {
  return row.variationSourceExperienceId == null && row.variationSourceRevision == null;
}
function validBinding(row: SnapshotVisibility) {
  return typeof row.variationSourceExperienceId === "string" && row.variationSourceExperienceId.length > 0 &&
    row.variationSourceExperienceId.length <= 64 && Number.isSafeInteger(row.variationSourceRevision) &&
    row.variationSourceRevision! >= 1;
}

/** Callers must owner-scope their snapshot query. No cached verdict: report CAS, not
 * a best-effort cleanup flag, decides visibility after interrupted correction/erasure. */
export interface SnapshotVisibilityOptions { session?: ClientSession; styleMemory?: StyleMemoryData }
export async function visibleSnapshots<T extends SnapshotVisibility>(owner: string | { toString(): string }, rows: T[], options: SnapshotVisibilityOptions = {}): Promise<T[]> {
  let styleMemory: StyleMemoryData | null = options.styleMemory ?? null;
  if (rows.some(row => !row.redacted && row.styleContext != null) && !styleMemory) {
    try { styleMemory = (await readStyleMemoryOwner(String(owner), options.session)).data; }
    catch (error) { if (!(error instanceof StyleMemoryError && error.status === 410)) throw error; }
  }
  const ids = [...new Set(rows.filter(row => !row.redacted && !unbound(row) && validBinding(row))
    .map(row => row.variationSourceExperienceId!))];
  const current = new Map<string, number>();
  if (ids.length) {
    const reports = await experienceCollection().find({ user: new Types.ObjectId(String(owner)),
      experienceId: { $in: ids }, lifecycle: "active" },
      { session: options.session, projection: { experienceId: 1, currentRevision: 1 } }).toArray();
    for (const report of reports) current.set(report.experienceId, report.currentRevision!);
  }
  return rows.filter(row => !row.redacted && (row.styleContext == null || !!styleMemory && contextIsVisible(styleMemory, row.styleContext)) && (unbound(row) ||
    (validBinding(row) && current.get(row.variationSourceExperienceId!) === row.variationSourceRevision)));
}
export async function snapshotVisible(owner: string | { toString(): string }, row: SnapshotVisibility, options: SnapshotVisibilityOptions = {}): Promise<boolean> {
  return (await visibleSnapshots(owner, [row], options)).length === 1;
}
