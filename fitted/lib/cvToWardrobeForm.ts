/**
 * Maps CV inference API response to wardrobe form values.
 * Pure function for easy unit testing.
 */

export type CVInferResponse = {
  category?: { value?: string };
  type?: { value?: string };
  colors?: Array<{ value?: string }>;
  color_primary?: { value?: string };
  pattern?: { value?: string };
  style?: { value?: string };
};

export type WardrobeFormValues = {
  name: string;
  category: string;
  subCategory?: string;
  pattern?: string;
  colors: string[];
  fit: string;
  size: string;
  formality: string;
  seasons: string[];
  occasions: string[];
  notes: string;
};

export function cvResponseToFormValues(cv: CVInferResponse): WardrobeFormValues {
  const category = cv.category?.value ?? "top";
  const typeVal = cv.type?.value ?? "";
  const name = typeVal ? typeVal.charAt(0).toUpperCase() + typeVal.slice(1).replace(/-/g, " ") : "";
  const colorStrs = (cv.colors ?? []).map((c) => c.value ?? "").filter(Boolean);
  const colors = colorStrs.length ? colorStrs : (cv.color_primary?.value ? [cv.color_primary.value] : []);
  const style = (cv.style?.value ?? "").toLowerCase();
  const formalityMap: Record<string, string> = {
    casual: "Casual",
    formal: "Formal",
    business: "Business Casual",
    athletic: "Casual",
  };
  const formality = formalityMap[style] ?? "";
  const pattern = cv.pattern?.value ?? "";
  const occasionFromStyle: Record<string, string> = {
    casual: "Everyday",
    formal: "Formal Event",
    athletic: "Workout",
    business: "Work",
  };
  const occasions = style && occasionFromStyle[style] ? [occasionFromStyle[style]] : [];
  return {
    name,
    category,
    subCategory: typeVal || undefined,
    pattern: pattern || undefined,
    colors,
    fit: "",
    size: "",
    formality,
    seasons: [],
    occasions,
    notes: "",
  };
}
