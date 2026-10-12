/** Current garment layering eligibility; absent/legacy labels carry no eligibility. */
export const LAYER_ROLES = ["base", "mid", "outer"] as const;
export type LayerRole = typeof LAYER_ROLES[number];
export function normalizeLayerRole(value: unknown): LayerRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return LAYER_ROLES.includes(role as LayerRole) ? role as LayerRole : null;
}
