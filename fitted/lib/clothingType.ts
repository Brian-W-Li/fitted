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
  // The UI's "Cargos" Type option must keyword-rescue like every other bottom. PLURAL ONLY —
  // the bottom rung runs before the outer rung, so a bare "cargo" would mis-slot "Cargo
  // Jacket"/"Cargo Vest" as bottom (whole-word matching keeps "cargos" from matching those).
  "cargos",
  // Skirt-adjacent / cropped-trouser nouns ("capris" plural-only, like "cargos"). Adding here
  // auto-extends the adjectival-"dress" guard below — do not hand-mirror.
  "skort", "culottes", "capris",
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
 * ⚠ Two-taxonomy seam (spec §6.1/§18-H52 rung-2). `category`/`subCategory` (the display + CV
 * vocabulary — "what is this garment called") and `clothingType` (the engine's outfit-slot
 * partition — "what slot does it fill") are INTENTIONALLY DIFFERENT cuts and legitimately
 * disagree: a coat is `category="top"` but `clothingType="outer_layer"`; a jumpsuit is
 * `category="one piece"` but `clothingType="dress"`. Do NOT "reconcile" them by equating the two,
 * and do NOT switch the wardrobe UI filter to this derived `clothingType` yet — it is invisible
 * and uncorrectable, so filtering on it would make a mis-derivation silently authoritative (a
 * wrongly-typed item vanishes from every filter with no recourse). User correction of clothingType
 * is the W-track review surface (§18-H52 rung-2); the filter-key migration is decided THERE, after
 * correction exists — not here.
 *
 * The upload form does not supply clothingType today, so it is derived from the
 * garment's category / subCategory / name (+ layerRole) at ingestion. One ordered
 * first-match cascade, consolidating the two divergent legacy string-match sites
 * (docs/plans/m4-data-model-migration.md §10.3). Out-of-ontology rows default
 * to "top". The W-track VLM CV / review surface later supplies clothingType directly.
 *
 * "dress" counts as a one-piece only when it is NOT immediately followed by a garment noun
 * (the head-noun-last rule — see ADJECTIVAL_DRESS), so the real "Dress Shoes" footwear option
 * is not mis-partitioned. Precedence principle (the "suit dress" mis-slot fix,
 * docs/plans/clothingtype-slot-correctness.md §4-B): STRUCTURAL signals — category equality,
 * `layerRole`, bottom/shoe nouns (no dress is named with "skirt"/"heels" as head noun) — beat
 * the bare-dress NAME guess, so a "suit dress" filed under category=bottom/sub=skirt is the
 * skirt it structurally is, not the dress its set-name suggests. The bare-dress guess in turn
 * beats the outerwear name-keywords, because [outer-noun+"dress"] compounds (blazer dress,
 * coat dress) are dresses while a real outer garment carrying a bare non-adjectival "dress"
 * token essentially never occurs. A name-only "wrap dress" (no structural signal) still →
 * dress. The modifier noun set is derived from the rung vocabularies so it cannot drift out
 * of sync.
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

  // 1. dress (one-piece, STRUCTURAL only): explicit category or an unconditional one-piece
  //    keyword. The bare-dress NAME guess deliberately lives lower (rung 5).
  if (cat === "one piece" || has(ONE_PIECE_KEYWORDS)) return "dress";
  // 2. bottom (closed compounds listed explicitly — whole-word matching means "sweatpants"
  //    does NOT match "pants"; two-word "sweat pants" already would).
  if (["bottom", "bottoms"].includes(cat) || has(BOTTOM_KEYWORDS)) return "bottom";
  // 3. shoes
  if (cat === "footwear" || has(SHOE_KEYWORDS)) return "shoes";
  // 4. outer_layer by layerRole — a deliberate human structural choice beats any name guess.
  if (layerRole === "outer") return "outer_layer";
  // 5. bare non-adjectival "dress" name — above the outerwear NAME keywords so
  //    [outer-noun+"dress"] compounds (blazer/coat dress) stay dresses.
  if (isOnePieceDress) return "dress";
  // 6. clear outerwear names.
  if (has(OUTER_KEYWORDS)) return "outer_layer";
  // 7. top (incl. the mid-collapse knits) and the out-of-ontology default.
  return "top";
}
