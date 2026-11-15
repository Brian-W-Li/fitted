// The add form supplies a complete record; editing must only write deliberate changes.
// In particular, re-sending unchanged taxonomy triggers server type/warmth derivation,
// and UI placeholders must not turn unrelated missing/null facts into explicit clears.
const TEXT_FIELDS = ["name", "category", "subCategory", "pattern", "layerRole", "fit"] as const;
const ARRAY_FIELDS = ["colors", "seasons", "occasions"] as const;
type EditableField = (typeof TEXT_FIELDS)[number] | (typeof ARRAY_FIELDS)[number];
type FormValues = Partial<Record<EditableField, unknown>>;

/** current is the complete submitted modal snapshot, with UI defaults for blank fields;
 * it is not an already-sparse PATCH. initial may retain null/absent stored facts. */
export function wardrobeEditPatch(initial: FormValues, current: FormValues): Record<string, string | string[]> {
  const patch: Record<string, string | string[]> = {};
  for (const field of TEXT_FIELDS) {
    const before = typeof initial[field] === "string" ? initial[field].trim() : "";
    const after = typeof current[field] === "string" ? current[field].trim() : "";
    if (before !== after) patch[field] = after;
  }
  for (const field of ARRAY_FIELDS) {
    const before = (initial[field] ?? []) as string[];
    const after = (current[field] ?? []) as string[];
    if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
      patch[field] = after;
    }
  }
  return patch;
}
