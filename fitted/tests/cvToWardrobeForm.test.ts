import { cvResponseToFormValues, type CVInferResponse } from "@/lib/cvToWardrobeForm";

describe("cvResponseToFormValues", () => {
  it("maps full CV response to form values", () => {
    const cv: CVInferResponse = {
      category: { value: "top" },
      type: { value: "t-shirt" },
      color_primary: { value: "#382828" },
      colors: [
        { value: "#382828" },
        { value: "#986848" },
      ],
      pattern: { value: "plaid" },
      layer_role: "base",
    };
    const result = cvResponseToFormValues(cv);
    expect(result.name).toBe("T shirt");
    expect(result.category).toBe("top");
    expect(result.subCategory).toBe("t-shirt");
    expect(result.colors).toEqual(["#382828", "#986848"]);
    expect(result.pattern).toBe("plaid");
    expect(result.layerRole).toBe("base");
    expect(result.occasions).toEqual([]);
    expect(result.seasons).toEqual([]);
    expect(result.fit).toBe("");
    expect(result.notes).toBe("");
  });

  it("defaults category to top when missing", () => {
    const result = cvResponseToFormValues({});
    expect(result.category).toBe("top");
  });

  it("uses color_primary when colors array is empty", () => {
    const cv: CVInferResponse = {
      color_primary: { value: "#abcdef" },
      colors: [],
    };
    const result = cvResponseToFormValues(cv);
    expect(result.colors).toEqual(["#abcdef"]);
  });

  it("uses colors array when present", () => {
    const cv: CVInferResponse = {
      colors: [{ value: "#111" }, { value: "#222" }],
    };
    const result = cvResponseToFormValues(cv);
    expect(result.colors).toEqual(["#111", "#222"]);
  });

  it("formats name from type (capitalized, hyphens to spaces)", () => {
    const cv: CVInferResponse = { type: { value: "dress-shirt" } };
    const result = cvResponseToFormValues(cv);
    expect(result.name).toBe("Dress shirt");
  });

  it("returns empty name when type is missing", () => {
    const result = cvResponseToFormValues({});
    expect(result.name).toBe("");
  });

});
