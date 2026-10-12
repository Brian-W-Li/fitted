import { Types } from "mongoose";
import User, { type OutfitPlanRecord } from "@/models/User";
import { exactKeys, object, objectId, operationId } from "@/lib/outfitExperience/contract";
import { validateCalendarDay } from "@/lib/outfitExperience/date";
import { ExperienceError, ExperienceValidationError } from "@/lib/outfitExperience/errors";
import { getSuggestion } from "@/lib/outfitExperience/read";

export const MAX_ACTIVE_PLANS = 20;
export const MAX_PLAN_IDENTITIES = 1000;
interface Options { now?: () => Date; beforeWrite?: () => Promise<void>; afterWrite?: () => Promise<void> }
interface PlanningOwner { outfitPlans?: OutfitPlanRecord[]; planningVersion?: number }
function dateInput(raw: Record<string, unknown>, now: Date) {
  const day = validateCalendarDay(raw.plannedFor, raw.timezone, now);
  if (day.date < day.today) throw new ExperienceValidationError("request", "Choose today or a future date for your plan");
  return { plannedFor: day.date, timezone: day.timezone };
}
function revision(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) throw new ExperienceValidationError("request", "Invalid plan revision");
  return raw as number;
}
function acknowledgement(plan: OutfitPlanRecord) {
  return { planId: plan.planId, revision: plan.revision, plannedFor: plan.plannedFor };
}

/** Intent only. One owner-document CAS avoids orphan writes and distributed capacity races. */
export class OutfitPlanningStore {
  constructor(private readonly options: Options = {}) {}
  private async owner(user: Types.ObjectId): Promise<PlanningOwner> {
    const owner = await User.collection.findOne({ _id: user }, { projection: { outfitPlans: 1, planningVersion: 1 } });
    if (!owner) throw new ExperienceError(410, "account_unavailable");
    return owner as PlanningOwner;
  }
  private async available(ownerId: string, plan: OutfitPlanRecord) {
    const suggestion = await getSuggestion(ownerId, plan.snapshotId!, plan.candidateId!);
    if (suggestion.items.some(item => item.availability !== "available")) throw new ExperienceError(409, "plan_items_unavailable");
  }
  private async write(user: Types.ObjectId, owner: PlanningOwner, plans: OutfitPlanRecord[]) {
    await this.options.beforeWrite?.();
    const version = owner.planningVersion ?? 0;
    // Never upsert a User. A deletion either removes this write or prevents it entirely.
    const result = await User.collection.updateOne({ _id: user, ...(owner.planningVersion === undefined
      ? { planningVersion: { $exists: false } } : { planningVersion: version }) },
      { $set: { outfitPlans: plans, planningVersion: version + 1 } });
    if (!result.matchedCount) return false;
    await this.options.afterWrite?.();
    await this.owner(user); // Never acknowledge a write to an account deleted during the request.
    return true;
  }
  async create(ownerId: string, raw: unknown) {
    const input = object(raw);
    exactKeys(input, ["planId", "snapshotId", "candidateId", "plannedFor", "timezone"]);
    const planId = operationId(input.planId);
    const user = new Types.ObjectId(objectId(ownerId));
    const snapshotId = objectId(input.snapshotId);
    // Validate the calendar independent of the current bound first: an acknowledged retry
    // remains a retry even after midnight. Source identity is validated by the exact reader.
    const day = validateCalendarDay(input.plannedFor, input.timezone, this.options.now?.() ?? new Date());
    const proposed: OutfitPlanRecord = { planId, lifecycle: "active", revision: 1, snapshotId,
      candidateId: input.candidateId as string, plannedFor: day.date, timezone: day.timezone };
    const key = JSON.stringify({ snapshotId, candidateId: input.candidateId, plannedFor: day.date, timezone: day.timezone });
    for (let attempt = 0; attempt < 8; attempt++) {
      const owner = await this.owner(user);
      const plans = owner.outfitPlans ?? [];
      const previous = plans.find(plan => plan.planId === planId);
      if (previous) {
        if (previous.lifecycle === "removed") throw new ExperienceError(410, "plan_removed");
        if (previous.createKey !== key) throw new ExperienceError(409, "plan_identity_conflict");
        return acknowledgement(previous);
      }
      if (plans.some(plan => plan.lifecycle === "active" && plan.snapshotId === snapshotId && plan.candidateId === input.candidateId && plan.plannedFor === day.date))
        throw new ExperienceError(409, "already_planned");
      if (plans.filter(plan => plan.lifecycle === "active").length >= MAX_ACTIVE_PLANS) throw new ExperienceError(429, "active_plan_limit");
      if (plans.length >= MAX_PLAN_IDENTITIES) throw new ExperienceError(429, "planning_storage_limit");
      dateInput(input, this.options.now?.() ?? new Date());
      await this.available(ownerId, proposed);
      if (await this.write(user, owner, [...plans, { ...proposed, createKey: key }])) return acknowledgement(proposed);
    }
    throw new ExperienceError(409, "planning_busy");
  }
  async reschedule(ownerId: string, id: string, raw: unknown) {
    id = operationId(id);
    const input = object(raw);
    exactKeys(input, ["operationId", "expectedRevision", "plannedFor", "timezone"]);
    const commandId = operationId(input.operationId);
    const expected = revision(input.expectedRevision);
    const day = validateCalendarDay(input.plannedFor, input.timezone, this.options.now?.() ?? new Date());
    const key = JSON.stringify({ expected, plannedFor: day.date, timezone: day.timezone });
    const user = new Types.ObjectId(objectId(ownerId));
    for (let attempt = 0; attempt < 8; attempt++) {
      const owner = await this.owner(user);
      const plans = owner.outfitPlans ?? [];
      const previous = plans.find(plan => plan.planId === id);
      if (!previous) throw new ExperienceError(404, "plan_unavailable");
      if (previous.lifecycle === "removed") throw new ExperienceError(410, "plan_removed");
      if (previous.operationId === commandId) {
        if (previous.requestKey !== key) throw new ExperienceError(409, "plan_identity_conflict");
        return acknowledgement(previous);
      }
      if (previous.revision !== expected) throw new ExperienceError(409, "plan_revision_conflict");
      dateInput(input, this.options.now?.() ?? new Date());
      if (plans.some(plan => plan.planId !== id && plan.lifecycle === "active" && plan.snapshotId === previous.snapshotId && plan.candidateId === previous.candidateId && plan.plannedFor === day.date))
        throw new ExperienceError(409, "already_planned");
      await this.available(ownerId, previous);
      const next = { ...previous, plannedFor: day.date, timezone: day.timezone, revision: expected + 1,
        operationId: commandId, requestKey: key };
      if (await this.write(user, owner, plans.map(plan => plan.planId === id ? next : plan))) return acknowledgement(next);
    }
    throw new ExperienceError(409, "planning_busy");
  }
  async remove(ownerId: string, id: string) {
    id = operationId(id);
    const user = new Types.ObjectId(objectId(ownerId));
    for (let attempt = 0; attempt < 8; attempt++) {
      const owner = await this.owner(user);
      const plans = owner.outfitPlans ?? [];
      const previous = plans.find(plan => plan.planId === id);
      if (previous?.lifecycle === "removed") return { removed: true };
      if (!previous && plans.length >= MAX_PLAN_IDENTITIES) throw new ExperienceError(429, "planning_storage_limit");
      // Also reserve an absent ID: removal can arrive before a delayed create commits.
      const removed: OutfitPlanRecord = { planId: id, lifecycle: "removed" };
      const next = previous ? plans.map(plan => plan.planId === id ? removed : plan) : [...plans, removed];
      if (await this.write(user, owner, next)) return { removed: true };
    }
    throw new ExperienceError(409, "planning_busy");
  }
  async list(ownerId: string) {
    const owner = await this.owner(new Types.ObjectId(objectId(ownerId)));
    const active = (owner.outfitPlans ?? []).filter(plan => plan.lifecycle === "active")
      .sort((a, b) => a.plannedFor!.localeCompare(b.plannedFor!) || a.planId.localeCompare(b.planId));
    return { plans: await Promise.all(active.map(async plan => {
      let suggestion = null;
      try { suggestion = await getSuggestion(ownerId, plan.snapshotId!, plan.candidateId!); }
      catch (error) { if (!(error instanceof ExperienceError && error.status === 404)) throw error; }
      return { planId: plan.planId, revision: plan.revision!, plannedFor: plan.plannedFor!, timezone: plan.timezone!, suggestion };
    })) };
  }
}
