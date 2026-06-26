/**
 * Canonical clothingType vocabulary (M4).
 *
 * Wire values are exactly the `fitted_core` ItemType member names — no translation
 * table (docs/Fitted_Spec_v2.md §6.1). Shared by the wardrobe routes + UI so the
 * 5-value set is single-homed.
 */
import { mentionsAny } from "@/lib/keywordMatch";

export const CLOTHING_TYPES = [
  "top",
  "bottom",
  "dress",
  "outer_layer",
  "shoes",
] as const;

export type ClothingType = (typeof CLOTHING_TYPES)[number];

/**
 * Coerce an arbitrary input to a valid ClothingType. Unknown / out-of-ontology
 * values default to "top" (always a valid sampler partition; deployed parity).
 * Replaces the legacy 2-value `=== "bottom" ? "bottom" : "top"` funnel.
 */
export function normalizeClothingType(value: unknown): ClothingType {
  return CLOTHING_TYPES.includes(value as ClothingType)
    ? (value as ClothingType)
    : "top";
}

/**
 * M4 C2 — ingestion clothingType classifier (the §10.3 canonical rule).
 *
 * The upload form does not supply clothingType today, so it is derived from the
 * garment's category / subCategory / name (+ layerRole) at ingestion. One ordered
 * first-match cascade, consolidating the two divergent legacy string-match sites
 * (docs/plans/m4-data-model-migration.md §10.1/§10.3). Out-of-ontology rows default
 * to "top". The W-track VLM CV / review surface later supplies clothingType directly.
 *
 * Mid-layer knits (cardigan/hoodie/fleece) collapse to "top" UNLESS layerRole=="outer"
 * wins (the §10.3 collapse rule): a knit worn as the only upper layer is a valid base top.
 *
 * Keyword matching is whole-word (lib/keywordMatch), so "coat" matches "wool coat" but
 * not "petticoat"; the compound outerwear words we want ("raincoat"/"trenchcoat") are
 * listed explicitly.
 */
export function deriveClothingType(input: {
  category?: string;
  subCategory?: string;
  name?: string;
  layerRole?: string;
}): ClothingType {
  const cat = (input.category ?? "").toLowerCase().trim();
  const layerRole = (input.layerRole ?? "").toLowerCase().trim();
  const hay = [input.category, input.subCategory, input.name]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  const has = (words: string[]) => mentionsAny(hay, words);

  // 1. dress (one-piece)
  if (cat === "one piece" || has(["dress", "jumpsuit", "romper"])) return "dress";
  // 2. bottom (closed-compound forms listed explicitly — whole-word matching means
  // "sweatpants" does NOT match "pants"; two-word "sweat pants" already would)
  if (
    ["bottom", "bottoms"].includes(cat) ||
    has([
      "pants",
      "sweatpants",
      "joggers",
      "snowpants",
      "jeggings",
      "jeans",
      "shorts",
      "skirt",
      "trousers",
      "chinos",
      "leggings",
    ])
  )
    return "bottom";
  // 3. shoes
  if (
    cat === "footwear" ||
    has(["shoes", "sneakers", "boots", "sandals", "loafers", "heels", "flats"])
  )
    return "shoes";
  // 4. outer_layer — explicit layerRole=="outer" wins, else clear outerwear names
  if (
    layerRole === "outer" ||
    has([
      "jacket",
      "coat",
      "raincoat",
      "trenchcoat",
      "peacoat",
      "blazer",
      "parka",
      "puffer",
      "windbreaker",
      "trench",
      "overcoat",
    ])
  )
    return "outer_layer";
  // 5/6. top (incl. the mid-collapse knits) and the out-of-ontology default
  return "top";
}
