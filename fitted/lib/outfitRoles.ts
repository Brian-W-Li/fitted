/** Display composition roles independently of a garment's closet category. */
const ROLE_ORDER: Record<string, number> = {
  one_piece: 0, base_top: 1, mid_layer: 2, base_bottom: 3, outer_layer: 4, shoes: 5,
};
const TYPE_ORDER: Record<string, number> = { dress: 0, top: 1, bottom: 3, outer_layer: 4, shoes: 5 };
export function outfitItemOrder(item: { role?: string; clothingType?: string | null }): number {
  return ROLE_ORDER[item.role ?? ""] ?? TYPE_ORDER[item.clothingType ?? ""] ?? 6;
}
export function displayRoleLabel(clothingType?: string | null, role?: string): string {
  return role === "mid_layer" ? "Mid layer" : clothingType ?? "Item";
}
