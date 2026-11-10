import { Types } from "mongoose";
import WardrobeItem from "@/models/WardrobeItem";
import { normalizeLayerRole } from "@/lib/layerRole";
import { CLOTHING_TYPES, type ClothingType } from "@/lib/clothingType";
import { type ActualItem, type WearInput } from "./contract";
import { ExperienceValidationError } from "./errors";
import { requireSource, type MemorySnapshot } from "./source";

function invalid(message: string): never { throw new ExperienceValidationError("request", message); }
export interface ResolvedComposition { memberItemIds: Types.ObjectId[]; memberItems?: ActualItem[]; snapshot?: MemorySnapshot }

/** The shown candidate remains provenance. Only the confirmed, owner-bound members are indexed as worn. */
export async function resolveComposition(user: Types.ObjectId, input: WearInput, snapshotId: string, candidateId: string, previousMembers: ActualItem[] = []): Promise<ResolvedComposition> {
  const source = await requireSource(user, snapshotId, candidateId);
  const previous = new Map(previousMembers.map(item => [item.itemId, item]));
  if (input.compositionStatus === "as_shown") {
    const captured = new Map(source.snapshot.itemSnapshots.map(item => [item.itemId, item.engineVisible]));
    const layered = source.candidate.items.some(item => item.role === "mid_layer");
    const roles = new Map(source.candidate.items.map(item => [item.itemId, item.role]));
    return { snapshot: source.snapshot, memberItemIds: source.memberItemIds, memberItems: source.memberItemIds.map(id => {
      const itemId = String(id);
      const item = previous.get(itemId) ?? captured.get(itemId);
      const role = roles.get(itemId);
      return { itemId, name: (item?.name ?? "Unknown item").slice(0, 200), clothingType: item?.clothingType ?? "unknown",
        ...(layered && (role === "base_top" || role === "mid_layer") ? { role } : {}) };
    }) };
  }
  const requested = input.memberItemIds!;
  const sourceIds = new Set(source.memberItemIds.map(String));
  if (!requested.some(id => sourceIds.has(id)) ||
      requested.length === sourceIds.size && requested.every(id => sourceIds.has(id))) {
    invalid("A changed outfit must keep at least one shown piece and actually change another");
  }
  // Availability today is not evidence about a past wear; require owner membership, but allow
  // a currently unavailable garment. A removed closet row has no current owner proof here.
  const items = await WardrobeItem.find({ user, _id: { $in: requested.map(id => new Types.ObjectId(id)) } })
    .select({ _id: 1, name: 1, clothingType: 1, layerRole: 1 }).lean() as unknown as { _id: Types.ObjectId; name: string; clothingType: string; layerRole?: string }[];
  if (items.length !== requested.length) invalid("Every actual piece must still belong to your closet");
  const byId = new Map(items.map(item => {
    const retained = previous.get(String(item._id));
    // Current rows prove ownership, not a rewrite of previously reported facts.
    // Layer roles follow the deliberately changed composition; recorded eligibility
    // wins when present, otherwise current declared eligibility guides a new layer.
    return [String(item._id), retained ? { ...item, name: retained.name, clothingType: retained.clothingType,
      layerRole: retained.role === "mid_layer" ? "mid" : retained.role === "base_top" ? "base" : item.layerRole } : item];
  }));
  const slots = new Set<string>();
  for (const id of requested) {
    const type = byId.get(id)?.clothingType;
    if (!type || !CLOTHING_TYPES.includes(type as ClothingType) || (type !== "top" && slots.has(type))) invalid("Choose at most one piece for each outfit slot");
    slots.add(type);
  }
  const tops = requested.map(id => byId.get(id)!).filter(item => item.clothingType === "top");
  // A mid-capable knit can be the only top. With two tops, exactly one must have
  // explicit mid eligibility; two knits are not a supported multi-mid stack.
  const layered = tops.length === 2;
  if (tops.length > 2 || (layered && tops.filter(item => normalizeLayerRole(item.layerRole) === "mid").length !== 1)) {
    invalid("Choose one top, or a base top and one top marked as a mid layer");
  }
  const complete = slots.has("dress") ? !slots.has("top") && !slots.has("bottom")
    : slots.has("top") && slots.has("bottom");
  if (!complete) invalid("Choose a dress or a top and bottom, with an optional mid layer for separates, outer layer and shoes");
  return { snapshot: source.snapshot, memberItemIds: requested.map(id => new Types.ObjectId(id)),
    memberItems: requested.map(id => {
      const item = byId.get(id)!;
      return { itemId: id, name: item.name.slice(0, 200), clothingType: item.clothingType,
        ...(layered && item.clothingType === "top" ? { role: normalizeLayerRole(item.layerRole) === "mid" ? "mid_layer" as const : "base_top" as const } : {}) };
    }) };
}
