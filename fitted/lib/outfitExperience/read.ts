import { weatherSourceFromSnapshot, weatherSignalsFromSnapshot } from "@/lib/weatherContext";
import { visibleSnapshots } from "@/lib/snapshotVisibility";
import { Types } from "mongoose";
import { experienceCollection, type ExperienceRecord } from "@/models/OutfitExperience";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import WardrobeItem from "@/models/WardrobeItem";
import { EXPERIENCE_PAGE_SIZE, EXPERIENCE_SCAN_SIZE, objectId, operationId } from "./contract";
import { userWearContext, suggestedWearContext } from "./context";
import { ExperienceError, ExperienceValidationError } from "./errors";
import { visibleSnapshot, shownCandidate, SOURCE_PROJECTION, type MemorySnapshot, type SourceCandidate } from "./source";

interface Cursor { v: 1; kind: string; owner: string; filter: string; id: string; position: number }
const CURRENT_STATE_PROJECTION = { user: 1, experienceId: 1, lifecycle: 1, snapshotId: 1, candidateId: 1, currentRevision: 1, revisions: { $slice: -1 } };
function readCursor(raw: string | undefined, kind: string, owner: string, filter: string): Cursor | null {
  if (raw === undefined) return null;
  try {
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (c.v !== 1 || c.kind !== kind || c.owner !== owner || c.filter !== filter ||
      !Number.isInteger(c.position) || c.position < -1 || c.position > 1000) throw new Error();
    objectId(c.id);
    return c;
  } catch { throw new ExperienceValidationError("request", "Invalid cursor for this owner or filter"); }
}
function cursor(kind: string, owner: string, filter: string, id: Types.ObjectId, position = -1): string {
  return Buffer.from(JSON.stringify({ v: 1, kind, owner, filter, id: id.toHexString(), position })).toString("base64url");
}
function pageLimit(value = EXPERIENCE_PAGE_SIZE): number {
  if (!Number.isInteger(value) || value < 1 || value > EXPERIENCE_PAGE_SIZE) throw new ExperienceValidationError("request", "Invalid page size");
  return value;
}

async function displayCandidate(user: Types.ObjectId, source: MemorySnapshot, candidate: SourceCandidate) {
  const ids = candidate.items.map(i => new Types.ObjectId(objectId(i.itemId)));
  const wardrobe = await WardrobeItem.collection.find({ user, _id: { $in: ids } }, { projection: { name: 1, clothingType: 1, isAvailable: 1 } }).toArray();
  return candidate.items.map(i => {
    const past = source.itemSnapshots.find(s => s.itemId === i.itemId)?.engineVisible;
    const current = wardrobe.find(w => String(w._id) === i.itemId);
    return {
      itemId: i.itemId, name: past?.name ?? "Unknown item", clothingType: past?.clothingType ?? null,
      imageUrl: past?.imageUrl ?? null,
      availability: !current ? "missing" : current.isAvailable === false ? "unavailable" : "available",
      changed: !!current && (current.name !== past?.name || current.clothingType !== past?.clothingType),
    };
  });
}
async function displayActual(user: Types.ObjectId, recorded: { itemId: string; name: string; clothingType: string }[], sourceItems: Awaited<ReturnType<typeof displayCandidate>>) {
  const ids = recorded.map(item => new Types.ObjectId(objectId(item.itemId)));
  const wardrobe = await WardrobeItem.collection.find({ user, _id: { $in: ids } },
    { projection: { name: 1, clothingType: 1, isAvailable: 1 } }).toArray();
  const current = new Map(wardrobe.map(item => [String(item._id), item]));
  const source = new Map(sourceItems.map(item => [item.itemId, item]));
  return recorded.map(item => {
    const now = current.get(item.itemId);
    return { ...item, imageUrl: source.get(item.itemId)?.imageUrl ?? null,
      availability: !now ? "missing" as const : now.isAvailable === false ? "unavailable" as const : "available" as const,
      changed: !!now && (now.name !== item.name || now.clothingType !== item.clothingType) };
  });
}

/** Owner-only current-state view; revision payloads/retry keys are never exposed. */
export async function experienceView(record: ExperienceRecord) {
  if (record.lifecycle === "erased") return { experienceId: record.experienceId, lifecycle: "erased" as const };
  const revision = record.revisions![record.revisions!.length - 1];
  const source = await visibleSnapshot(record.user, record.snapshotId!);
  const candidate = source && shownCandidate(source, record.candidateId!);
  const visible = !!source && !!candidate;
  const state = { ...revision.state };
  if (!visible && state.context.source === "suggestion" && !state.context.confirmed) state.context = suggestedWearContext("");
  const sourceItems = source && candidate ? await displayCandidate(record.user, source, candidate) : [];
  const items = state.memberItems
    ? await displayActual(record.user, state.memberItems, sourceItems) : sourceItems;
  return {
    experienceId: record.experienceId, lifecycle: record.lifecycle, currentRevision: record.currentRevision,
    state, sourceAvailable: visible,
    source: visible ? { snapshotId: record.snapshotId!.toHexString(), candidateId: record.candidateId } : null,
    items, sourceItems,
  };
}
export async function getExperience(ownerId: string, id: string) {
  const row = await experienceCollection().findOne({ user: new Types.ObjectId(objectId(ownerId)), experienceId: operationId(id) }, { projection: CURRENT_STATE_PROJECTION });
  if (!row) throw new ExperienceError(404, "experience_unavailable");
  return experienceView(row);
}
export interface RecallOptions { itemId?: string; context?: string; outcome?: string; lifecycle?: "active" | "retracted"; cursor?: string; limit?: number }
export async function recallExperiences(ownerId: string, options: RecallOptions = {}) {
  ownerId = objectId(ownerId);
  const user = new Types.ObjectId(ownerId);
  const limit = pageLimit(options.limit);
  const itemId = options.itemId === undefined ? null : objectId(options.itemId);
  const context = options.context === undefined ? null : userWearContext(options.context).exactScopeKey;
  if (options.context !== undefined && context === null) throw new ExperienceValidationError("context", "Choose a nonempty context filter");
  const outcome = options.outcome ?? null;
  if (outcome !== null && !["worked", "change_next_time", "unknown"].includes(outcome)) throw new ExperienceValidationError("request", "Invalid outcome filter");
  const lifecycle = options.lifecycle ?? "active";
  if (lifecycle !== "active" && lifecycle !== "retracted") throw new ExperienceValidationError("request", "Invalid lifecycle filter");
  const filter = JSON.stringify({ itemId, context, outcome, lifecycle });
  const after = readCursor(options.cursor, "recall", ownerId, filter);
  const rows = await experienceCollection().find({
    user, lifecycle, ...(itemId ? { memberItemIds: new Types.ObjectId(itemId) } : {}),
    ...(after ? { _id: { $lt: new Types.ObjectId(after.id) } } : {}),
  }, { projection: CURRENT_STATE_PROJECTION }).sort({ _id: -1 }).limit(EXPERIENCE_SCAN_SIZE + 1).toArray();
  const selected: ExperienceRecord[] = [];
  let consumed = 0;
  for (const row of rows.slice(0, EXPERIENCE_SCAN_SIZE)) {
    consumed++;
    const state = row.revisions![row.revisions!.length - 1].state;
    if ((context === null || state.context.exactScopeKey === context) && (outcome === null || state.outcome === outcome)) selected.push(row);
    if (selected.length === limit) break;
  }
  return {
    experiences: await Promise.all(selected.map(experienceView)),
    nextCursor: rows.length > consumed && consumed > 0 ? cursor("recall", ownerId, filter, rows[consumed - 1]._id!) : null,
  };
}

/** Pagination position includes the candidate inside a snapshot, so sibling cards survive paging. */
export async function recentSuggestions(ownerId: string, item: string, options: { cursor?: string; limit?: number } = {}) {
  ownerId = objectId(ownerId);
  const user = new Types.ObjectId(ownerId);
  const itemId = objectId(item);
  const limit = pageLimit(options.limit);
  const after = readCursor(options.cursor, "sources", ownerId, itemId);
  const rows = await GenerationSnapshot.collection.find({
    user, redacted: { $ne: true }, ...(after ? { _id: { $lte: new Types.ObjectId(after.id) } } : {}),
  }, { projection: SOURCE_PROJECTION }).sort({ _id: -1 }).limit(EXPERIENCE_SCAN_SIZE + 1).toArray() as MemorySnapshot[];
  const suggestions = [];
  let nextCursor: string | null = null;
  let consumed = 0;
  const visible = new Set(await visibleSnapshots(user, rows.slice(0, EXPERIENCE_SCAN_SIZE)));
  for (const row of rows.slice(0, EXPERIENCE_SCAN_SIZE)) {
    consumed++;
    if (!visible.has(row)) { nextCursor = cursor("sources", ownerId, itemId, row._id, 1000); continue; }
    for (let position = 0; position < row.shownCandidateIds.length; position++) {
      if (after && row._id.toHexString() === after.id && position <= after.position) continue;
      const candidate = shownCandidate(row, row.shownCandidateIds[position]);
      if (!candidate?.items.some(i => i.itemId === itemId)) continue;
      suggestions.push({ snapshotId: row._id.toHexString(), candidateId: candidate.candidateId,
        suggestionContext: row.occasion ?? "", items: await displayCandidate(user, row, candidate) });
      if (suggestions.length === limit) {
        // Navigation may lead to an empty final page, but it never loses a candidate.
        return { suggestions, nextCursor: cursor("sources", ownerId, itemId, row._id, position) };
      }
    }
    nextCursor = cursor("sources", ownerId, itemId, row._id, 1000);
  }
  return { suggestions, nextCursor: rows.length > consumed ? nextCursor : null };
}

/** Exact saved suggestion, independent of garment paging. Never regenerates. */
export async function getSuggestion(ownerId: string, snapshotId: string, candidateId: string) {
  const user = new Types.ObjectId(objectId(ownerId));
  const id = new Types.ObjectId(objectId(snapshotId));
  if (typeof candidateId !== "string" || !candidateId.length || candidateId.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(candidateId))
    throw new ExperienceValidationError("request", "Invalid candidate ID");
  const snapshot = await visibleSnapshot(user, id);
  const candidate = snapshot && shownCandidate(snapshot, candidateId);
  if (!snapshot || !candidate || !candidate.items.length) throw new ExperienceError(404, "source_unavailable");
  return { snapshotId: id.toHexString(), candidateId, suggestionContext: snapshot.occasion ?? "",
    weatherContext: snapshot.weatherRaw || snapshot.weather || null,
    weatherSource: weatherSourceFromSnapshot(snapshot.weatherSource),
    ...(weatherSignalsFromSnapshot(snapshot.weatherSignals) ? { weatherSignals: weatherSignalsFromSnapshot(snapshot.weatherSignals) } : {}),
    ...(snapshot.layerChoice ? { layerChoice: snapshot.layerChoice.status === "offered" &&
      !candidate.items.some(item => item.role === "outer_layer") ? { ...snapshot.layerChoice,
        note: "The original suggestions included an optional removable-layer option. This proposal does not include a layer. Rain and wind protection are unknown." } : snapshot.layerChoice } : {}),
    styleMove: candidate.styleMove ?? null,
    shownVariationAllowed: !snapshot.variationSourceExperienceId,
    items: await displayCandidate(user, snapshot, candidate) };
}
