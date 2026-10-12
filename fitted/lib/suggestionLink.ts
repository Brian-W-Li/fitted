import type { PlanDay } from "@/lib/outfitPlanning/client";
export function suggestionLink(source: { snapshotId: string; candidateId: string }, day?: PlanDay) {
  return `/memory/proposal?${new URLSearchParams({ snapshotId: source.snapshotId, candidateId: source.candidateId, ...(day ? { plannedFor: day.plannedFor, timezone: day.timezone } : {}) })}`;
}
