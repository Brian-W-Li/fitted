import type { User } from "firebase/auth";
import { validateCalendarDay } from "@/lib/outfitExperience/date";
export interface PlanDay { plannedFor: string; timezone: string }
/** A link carries an editable default only, never a command or evidence of wear. */
export function planDayHint(plannedFor: unknown, timezone: unknown): PlanDay | undefined {
  try { const day = validateCalendarDay(plannedFor, timezone, new Date()); return { plannedFor: day.date, timezone: day.timezone }; }
  catch { return undefined; }
}
export function localPlanDay(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return { plannedFor: `${part("year")}-${part("month")}-${part("day")}`, timezone };
}
export class PlanningFailure extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function planningMessage(cause: unknown) {
  if (!(cause instanceof PlanningFailure)) return "Couldn't confirm this change. Retry uses the same request.";
  if (cause.code === "plan_items_unavailable") return "Some pieces are no longer available. Choose another outfit or update your closet.";
  if (cause.code === "source_unavailable") return "This proposal is no longer available. Choose another outfit.";
  if (cause.code === "already_planned") return "This outfit is already planned for that day. Find it in Planned outfits.";
  if (cause.code === "plan_revision_conflict") return "This plan changed elsewhere. Reload to see its current date.";
  if (cause.code === "plan_removed" || cause.status === 404) return "This plan was removed or is no longer available.";
  if (cause.code === "active_plan_limit") return "Your planned outfits list is full. Remove a plan before adding another.";
  if (cause.status === 429) return "Planning storage is full. Existing plans can still be changed or removed.";
  if (cause.status === 400) return cause.code;
  if (cause.status === 410) return "This account is no longer available.";
  return "Couldn't confirm this change. Retry uses the same request.";
}
export async function planningRequest(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const response = await fetch(path, { ...init, cache: "no-store", headers: {
    Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}),
  } });
  const data = await response.json();
  if (!response.ok) throw new PlanningFailure(response.status, data.error ?? "Planning is temporarily unavailable");
  return data;
}
export function canRetryPlanning(cause: unknown) {
  return !(cause instanceof PlanningFailure) || cause.status >= 500 || cause.code === "planning_busy";
}
