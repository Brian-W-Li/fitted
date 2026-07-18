import { validateWardrobeForm, normalizeColor } from "@/lib/wardrobeValidation";

/**
 * Error strings must match lib/wardrobeValidation.ts exactly —
 * they are shown in the add/edit modal and must be consistent.
 */
describe("validateWardrobeForm", () => {
  const validPayload = {
    name: "Blue t-shirt",
    category: "top",
    subCategory: "t-shirt",
    colors: ["#1a2b3c"],
  };

  it("returns valid for payload with all required fields", () => {
    const result = validateWardrobeForm(validPayload);
    expect(result.valid).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      name: "",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe("Name is required.");
  });

  it("rejects whitespace-only name", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      name: "   ",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe("Name is required.");
  });

  it("rejects missing name", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      name: undefined,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects empty category", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      category: "",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe("Category is required.");
  });

  it("rejects missing category", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      category: undefined,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects empty type (subCategory)", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      subCategory: "",
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe("Type is required.");
  });

  it("rejects missing type (subCategory)", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      subCategory: undefined,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects empty colors array", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      colors: [],
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe("Add at least one color.");
  });

  it("rejects missing colors", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      colors: undefined,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts multiple colors", () => {
    const result = validateWardrobeForm({
      ...validPayload,
      colors: ["#111", "#222", "#333"],
    });
    expect(result.valid).toBe(true);
  });
});

/**
 * normalizeColor is the single home shared by the Add-color button and the save-time flush in
 * page.tsx handleSubmit (the fix for "typed 'red', didn't click Add, Save failed 'Add at least one
 * color'"). If this contract drifts, the flush would either reject valid input or admit garbage.
 */
describe("normalizeColor", () => {
  it("accepts a plain color name, lowercased", () => {
    expect(normalizeColor("Red")).toEqual({ ok: true, value: "red" });
  });

  it("collapses whitespace in a multi-word name", () => {
    expect(normalizeColor("  light   blue ")).toEqual({ ok: true, value: "light blue" });
  });

  it("accepts a hyphenated name", () => {
    expect(normalizeColor("blue-green")).toEqual({ ok: true, value: "blue-green" });
  });

  it("accepts a 6-hex with a leading #, lowercased", () => {
    expect(normalizeColor("#AABBCC")).toEqual({ ok: true, value: "#aabbcc" });
  });

  it("accepts a bare 6-hex and prefixes #", () => {
    expect(normalizeColor("AABBCC")).toEqual({ ok: true, value: "#aabbcc" });
  });

  it("rejects an empty/whitespace input with a blank reason (caller no-ops)", () => {
    expect(normalizeColor("   ")).toEqual({ ok: false, error: "" });
  });

  it("rejects a malformed entry (digits, symbols) with the guidance message", () => {
    const r = normalizeColor("123");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe(
      'Use a color name (e.g. "navy") or a hex code (e.g. #382828).',
    );
  });

  it("rejects a 3-digit hex (only 6-hex is accepted)", () => {
    expect(normalizeColor("#abc").ok).toBe(false);
  });
});
