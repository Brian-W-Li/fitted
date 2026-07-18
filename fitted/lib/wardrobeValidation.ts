/**
 * Client-side validation for wardrobe add/edit form.
 * Keeps required-field rules in one place for use in the UI and tests.
 */

export type WardrobeFormPayload = {
  name?: string;
  category?: string;
  subCategory?: string;
  colors?: string[];
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export type ColorNormalizeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Normalize a single color entry: a NAME ("navy", "light blue") → lowercased/space-collapsed, or a
 * 6-digit hex (with or without a leading #) → "#rrggbb". Single-homed so the add-color button AND
 * the save-time flush (page.tsx handleSubmit) share one rule — the flush is why "red" typed but not
 * "Add"-clicked no longer strands the user at "Add at least one color". An empty input is a no-op
 * reject with a blank reason (callers ignore it); a malformed non-empty input carries the reason.
 */
export function normalizeColor(raw: string): ColorNormalizeResult {
  const h = typeof raw === "string" ? raw.trim() : "";
  if (!h) return { ok: false, error: "" };
  const hex = /^#[0-9A-Fa-f]{6}$/.test(h)
    ? h.toLowerCase()
    : /^[0-9A-Fa-f]{6}$/.test(h)
      ? `#${h.toLowerCase()}`
      : null;
  const name = /^[A-Za-z][A-Za-z\- ]{1,23}$/.test(h) ? h.toLowerCase().replace(/\s+/g, " ") : null;
  const normalized = hex ?? name;
  if (!normalized) {
    return { ok: false, error: 'Use a color name (e.g. "navy") or a hex code (e.g. #382828).' };
  }
  return { ok: true, value: normalized };
}

export function validateWardrobeForm(data: WardrobeFormPayload): ValidationResult {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) {
    return { valid: false, error: "Name is required." };
  }
  const category = typeof data.category === "string" ? data.category.trim() : "";
  if (!category) {
    return { valid: false, error: "Category is required." };
  }
  // REQFIELDS-1 (Track 2, Fable-decided 2026-07-18): required = {name, category} only. The engine
  // derives a valid clothingType from category alone, and the server accepts items with no
  // subCategory and no colors (proven live: a text-sparse closet renders sane outfits). Requiring
  // Type + ≥1 color was a CLIENT-ONLY tax the engine doesn't need — 2 extra required fields × a
  // 15-item closet is real dropout risk (an abandoned closet is total loss; a sparse closet still
  // contributes photos + labels). subCategory + colors stay VISIBLE + encouraged (they enrich the
  // stylist prompt), just not gated. Do NOT re-tighten this without the same promise weighing —
  // if sparse closets depress like-rate, the fix is asking that friend to backfill via edit.
  return { valid: true };
}
