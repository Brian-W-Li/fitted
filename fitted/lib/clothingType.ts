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

// §10.3 garment-keyword vocabularies, kept as named groups so the adjectival-"dress" guard
// (below) is DERIVED from them instead of hand-mirrored — a keyword added to a rung is
// automatically a noun that "dress" can modify, so the "Dress Shoes → dress" footgun cannot
// silently reopen. The rung groups are exported for the drift-guard test.
const ONE_PIECE_KEYWORDS = ["jumpsuit", "romper", "sundress", "gown", "frock"];
export const BOTTOM_KEYWORDS = [
  "pants", "sweatpants", "joggers", "snowpants", "jeggings", "jeans",
  "shorts", "skirt", "trousers", "chinos", "leggings", "slacks",
];
export const SHOE_KEYWORDS = [
  "shoes", "sneakers", "boots", "sandals", "loafers", "heels", "flats",
];
export const OUTER_KEYWORDS = [
  "jacket", "coat", "raincoat", "trenchcoat", "peacoat", "blazer",
  "parka", "puffer", "windbreaker", "trench", "overcoat",
];
// Garment nouns "dress" can modify that have no rung of their own — once excluded from the
// one-piece bucket they fall through to the "top" default ("dress shirt", "dress socks").
// "oxford"/"mule"/"pump"/"brogue" are deliberately NOT in SHOE_KEYWORDS: bare "oxford" is
// ambiguous (an oxford shirt is a top), so they only guard the adjectival-"dress" case here.
// (An unambiguous garment like "slacks" lives in its real rung — BOTTOM_KEYWORDS — not here.)
// Exported so the drift-guard test covers every modifier noun, not only the rung arrays.
export const DRESS_MODIFIER_EXTRA = [
  "shirt", "top", "tee", "blouse", "polo", "sock",
  "oxford", "mule", "pump", "brogue",
];

// "dress" is a MODIFIER (not a one-piece) when immediately followed by a garment noun (the
// head-noun-last rule of English compounds: "dress shoes" is a shoe, "shirt dress" is a
// dress). The noun set is DERIVED from the rung vocabularies + the no-rung extras and
// normalised to accept an optional trailing "s"; the separator allows space OR hyphen
// (lib/keywordMatch treats a hyphen as a boundary, so "dress-shoes" reads like "dress shoes").
const DRESS_MODIFIER_NOUNS = [
  ...SHOE_KEYWORDS, ...BOTTOM_KEYWORDS, ...OUTER_KEYWORDS, ...DRESS_MODIFIER_EXTRA,
];
const ADJECTIVAL_DRESS = new RegExp(
  `\\bdress(es)?[\\s-]+(${DRESS_MODIFIER_NOUNS.map((n) => `${n.replace(/s$/, "")}s?`).join("|")})\\b`,
);
const BARE_DRESS = /\bdress(es)?\b/;

/**
 * M4 C2 — ingestion clothingType classifier (the §10.3 canonical rule).
 *
 * The upload form does not supply clothingType today, so it is derived from the
 * garment's category / subCategory / name (+ layerRole) at ingestion. One ordered
 * first-match cascade, consolidating the two divergent legacy string-match sites
 * (docs/plans/m4-data-model-migration.md §10.3). Out-of-ontology rows default
 * to "top". The W-track VLM CV / review surface later supplies clothingType directly.
 *
 * "dress" counts as a one-piece only when it is NOT immediately followed by a garment noun
 * (the head-noun-last rule — see ADJECTIVAL_DRESS), so the real "Dress Shoes" footwear option
 * is not mis-partitioned, while a miscategorized "wrap dress" still → dress (§10.3 "name
 * beats a coarse category"). The modifier noun set is derived from the rung vocabularies so
 * it cannot drift out of sync.
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
  const isOnePieceDress = BARE_DRESS.test(hay) && !ADJECTIVAL_DRESS.test(hay);

  // 1. dress (one-piece): explicit category, an unconditional one-piece keyword, or a
  //    non-adjectival "dress".
  if (cat === "one piece" || has(ONE_PIECE_KEYWORDS) || isOnePieceDress) return "dress";
  // 2. bottom (closed compounds listed explicitly — whole-word matching means "sweatpants"
  //    does NOT match "pants"; two-word "sweat pants" already would).
  if (["bottom", "bottoms"].includes(cat) || has(BOTTOM_KEYWORDS)) return "bottom";
  // 3. shoes
  if (cat === "footwear" || has(SHOE_KEYWORDS)) return "shoes";
  // 4. outer_layer — explicit layerRole=="outer" wins, else clear outerwear names.
  if (layerRole === "outer" || has(OUTER_KEYWORDS)) return "outer_layer";
  // 5/6. top (incl. the mid-collapse knits) and the out-of-ontology default.
  return "top";
}
