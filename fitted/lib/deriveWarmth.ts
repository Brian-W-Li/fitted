/**
 * M4 C2 — ingestion warmth derivation (the keyword stopgap).
 *
 * Today's CV does not emit warmth, so it is keyword-derived at ingestion from the
 * garment's category / subCategory / name, nudged by declared seasons. The ranker
 * only bins warmth into 3 bands (fitted_core response.py `_warmth_band`:
 * hot <3 / mild <6 / cold >=6), so a coarse band-center map suffices by construction.
 * The W-track VLM CV later writes warmth directly and this stopgap retires.
 *
 * Seeded from the existing string-match lists in the legacy recommend route
 * (app/api/recommend/route.ts ~:179/:237). Returns an integer in [0, 10].
 *
 * Keyword matching is whole-word (lib/keywordMatch) — "tee" won't match "sateen".
 */
import { mentionsAny } from "@/lib/keywordMatch";

// Band centers (the §10.3/§12.1 warmth map): hot 2 / mild 5 / cold 8.
const HOT_CENTER = 2;
const MILD_CENTER = 5;
const COLD_CENTER = 8;

// Clearly warm garments → cold band. (Generic "jacket"/"blazer" stay mild on purpose —
// a denim jacket isn't warm; only unambiguously insulating pieces land here.)
const WARM_KEYWORDS = [
  "parka",
  "puffer",
  "quilted",
  "coat",
  "overcoat",
  "peacoat",
  "wool",
  "fleece",
  "sweater",
  "cardigan",
  "hoodie",
  "thermal",
  "flannel",
  "sherpa",
  "turtleneck",
];
// NOTE: bare "down" is deliberately NOT a keyword — it misfires on "button-down".
// Down jackets are caught by "puffer"/"quilted"/"parka". Bare "knit" was dropped too:
// it's semantically ambiguous (a knit tank is light), so a bare "knit" reads mild;
// warm knits are caught by "sweater"/"cardigan"/"fleece"/"wool". Matching is whole-word
// (lib/keywordMatch), so "coat" matches "wool coat" but not "petticoat"/"raincoat".
// This list is intentionally SHORTER than the clothingType keyword sets: clothingType
// needs precise compound coverage (it's the sampler partition key), whereas warmth is a
// coarse 3-band stopgap that the W-track VLM CV supersedes — so a few compounds
// (snowpants/trenchcoat) reading "mild" instead of "cold" is within tolerance.

// Clearly light garments → hot band.
const LIGHT_KEYWORDS = [
  "tank",
  "shorts",
  "linen",
  "swim",
  "bikini",
  "sleeveless",
  "tee",
  "t-shirt",
  "sandals",
  "camisole",
  "cami",
];

function clampBand(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n)));
}

export function deriveWarmth(input: {
  category?: string;
  subCategory?: string;
  name?: string;
  seasons?: string[];
}): number {
  const haystack = [input.category, input.subCategory, input.name]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();

  // Warm checked first so a "fleece shorts" (rare) reads warm, not light.
  let warmth: number;
  if (mentionsAny(haystack, WARM_KEYWORDS)) {
    warmth = COLD_CENTER;
  } else if (mentionsAny(haystack, LIGHT_KEYWORDS)) {
    warmth = HOT_CENTER;
  } else {
    warmth = MILD_CENTER;
  }

  // Season nudge: +2/-2 on the 0-10 scale (enough to carry a center into the
  // adjacent band, e.g. mild 5 -> 7 = cold), applied only when the declared
  // seasons point one clear direction.
  const seasons = (input.seasons ?? []).map((s) => String(s).toLowerCase());
  const leansCold = seasons.some((s) => ["winter", "fall", "autumn"].includes(s));
  const leansHot = seasons.some((s) => ["summer", "spring"].includes(s));
  if (leansCold && !leansHot) warmth += 2;
  else if (leansHot && !leansCold) warmth -= 2;

  return clampBand(warmth);
}
