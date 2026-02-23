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
