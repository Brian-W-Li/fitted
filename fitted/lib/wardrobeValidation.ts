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
  const subCategory = typeof data.subCategory === "string" ? data.subCategory.trim() : "";
  if (!subCategory) {
    return { valid: false, error: "Type is required." };
  }
  const colors = Array.isArray(data.colors) ? data.colors : [];
  if (colors.length === 0) {
    return { valid: false, error: "Add at least one color." };
  }
  return { valid: true };
}
