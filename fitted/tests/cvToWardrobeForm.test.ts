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
      style: { value: "casual" },
    };
    const result = cvResponseToFormValues(cv);
    expect(result.name).toBe("T shirt");
    expect(result.category).toBe("top");
    expect(result.subCategory).toBe("t-shirt");
    expect(result.colors).toEqual(["#382828", "#986848"]);
    expect(result.pattern).toBe("plaid");
    expect(result.formality).toBe("Casual");
    expect(result.occasions).toEqual(["Everyday"]);
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

  it("maps style to formality", () => {
    expect(cvResponseToFormValues({ style: { value: "formal" } }).formality).toBe("Formal");
    expect(cvResponseToFormValues({ style: { value: "business" } }).formality).toBe("Business Casual");
    expect(cvResponseToFormValues({ style: { value: "athletic" } }).formality).toBe("Casual");
  });

  it("maps style to occasion", () => {
    expect(cvResponseToFormValues({ style: { value: "casual" } }).occasions).toEqual(["Everyday"]);
    expect(cvResponseToFormValues({ style: { value: "formal" } }).occasions).toEqual(["Formal Event"]);
    expect(cvResponseToFormValues({ style: { value: "athletic" } }).occasions).toEqual(["Workout"]);
    expect(cvResponseToFormValues({ style: { value: "business" } }).occasions).toEqual(["Work"]);
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

  it("treats style value as case-insensitive (CV may send Casual or casual)", () => {
    expect(cvResponseToFormValues({ style: { value: "Casual" } }).formality).toBe("Casual");
    expect(cvResponseToFormValues({ style: { value: "Casual" } }).occasions).toEqual(["Everyday"]);
    expect(cvResponseToFormValues({ style: { value: "FORMAL" } }).formality).toBe("Formal");
    expect(cvResponseToFormValues({ style: { value: "FORMAL" } }).occasions).toEqual(["Formal Event"]);
  });
});
