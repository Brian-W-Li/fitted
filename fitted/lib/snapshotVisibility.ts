import { Types } from "mongoose";
import { experienceCollection } from "@/models/OutfitExperience";

export interface SnapshotVisibility {
  redacted?: boolean;
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
export async function visibleSnapshots<T extends SnapshotVisibility>(owner: string | { toString(): string }, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.filter(row => !row.redacted && !unbound(row) && validBinding(row))
    .map(row => row.variationSourceExperienceId!))];
  const current = new Map<string, number>();
  if (ids.length) {
    const reports = await experienceCollection().find({ user: new Types.ObjectId(String(owner)),
      experienceId: { $in: ids }, lifecycle: "active" },
      { projection: { experienceId: 1, currentRevision: 1 } }).toArray();
    for (const report of reports) current.set(report.experienceId, report.currentRevision!);
  }
  return rows.filter(row => !row.redacted && (unbound(row) ||
    (validBinding(row) && current.get(row.variationSourceExperienceId!) === row.variationSourceRevision)));
}
export async function snapshotVisible(owner: string | { toString(): string }, row: SnapshotVisibility): Promise<boolean> {
  return (await visibleSnapshots(owner, [row])).length === 1;
}
