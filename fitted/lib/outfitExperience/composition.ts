import { Types } from "mongoose";
import WardrobeItem from "@/models/WardrobeItem";
import { CLOTHING_TYPES, type ClothingType } from "@/lib/clothingType";
import { type ActualItem, type WearInput } from "./contract";
import { ExperienceValidationError } from "./errors";
import { requireSource } from "./source";

function invalid(message: string): never { throw new ExperienceValidationError("request", message); }
export interface ResolvedComposition { memberItemIds: Types.ObjectId[]; memberItems?: ActualItem[] }

/** The shown candidate remains provenance. Only the confirmed, owner-bound members are indexed as worn. */
export async function resolveComposition(user: Types.ObjectId, input: WearInput, snapshotId: string, candidateId: string): Promise<ResolvedComposition> {
  const source = await requireSource(user, snapshotId, candidateId);
  if (input.compositionStatus === "as_shown") {
    const captured = new Map(source.snapshot.itemSnapshots.map(item => [item.itemId, item.engineVisible]));
    return { memberItemIds: source.memberItemIds, memberItems: source.memberItemIds.map(id => {
      const itemId = String(id);
      const item = captured.get(itemId);
      return { itemId, name: (item?.name ?? "Unknown item").slice(0, 200), clothingType: item?.clothingType ?? "unknown" };
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
    .select({ _id: 1, name: 1, clothingType: 1 }).lean() as unknown as { _id: Types.ObjectId; name: string; clothingType: string }[];
  if (items.length !== requested.length) invalid("Every actual piece must still belong to your closet");
  const byId = new Map(items.map(item => [String(item._id), item]));
  const slots = new Set<string>();
  for (const id of requested) {
    const type = byId.get(id)?.clothingType;
    if (!type || !CLOTHING_TYPES.includes(type as ClothingType) || slots.has(type)) invalid("Choose at most one piece for each outfit slot");
    slots.add(type);
  }
  const complete = slots.has("dress") ? !slots.has("top") && !slots.has("bottom")
    : slots.has("top") && slots.has("bottom");
  if (!complete) invalid("Choose a dress or a top and bottom, with optional outer layer and shoes");
  return { memberItemIds: requested.map(id => new Types.ObjectId(id)),
    memberItems: requested.map(id => {
      const item = byId.get(id)!;
      return { itemId: id, name: item.name.slice(0, 200), clothingType: item.clothingType };
    }) };
}
