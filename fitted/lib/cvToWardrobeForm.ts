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
  // Optional: "base", "mid", "outer" for layering; sent as a top-level field from CV.
  layer_role?: string;
};

export type WardrobeFormValues = {
  name: string;
  category: string;
  subCategory?: string;
  pattern?: string;
  colors: string[];
  fit: string;
  size: string;
   // Optional layering role we store on the wardrobe item
  layerRole?: string;
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
  const pattern = cv.pattern?.value ?? "";
  const layerRole = typeof cv.layer_role === "string" ? cv.layer_role : "";
  return {
    name,
    category,
    subCategory: typeVal || undefined,
    pattern: pattern || undefined,
    colors,
    fit: "",
    size: "",
    layerRole: layerRole || undefined,
    seasons: [],
    occasions: [],
    notes: "",
  };
}
