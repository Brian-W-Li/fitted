/**
 * Whole-word keyword matching for the ingestion classifiers (M4 C2).
 *
 * Uses word boundaries so a keyword only matches a standalone word, never a
 * substring of a larger one — "tee" no longer matches "sateen"/"velveteen",
 * "coat" no longer matches "petticoat", "skirt" no longer matches "skirted".
 * Hyphens count as boundaries, so "button-down" / "t-shirt" / "tee-shirt" behave
 * as expected. Compound garment words we DO want (e.g. "raincoat") are listed
 * explicitly in the keyword sets rather than relied on via substring.
 *
 * `haystackLower` is assumed already lower-cased by the caller.
 */
export function mentionsAny(haystackLower: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(haystackLower);
  });
}
