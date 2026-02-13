import { validateWardrobeForm } from "@/lib/wardrobeValidation";

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
