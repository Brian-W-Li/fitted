/**
 * M4 C2 — warmth derivation + clothingType normalization (unit).
 *
 * The ranker bins warmth into 3 bands: hot <3 / mild <6 / cold >=6
 * (fitted_core response.py `_warmth_band`). Tests assert band membership +
 * the always-valid-0..10 contract, not exact values beyond the band centers.
 */
import { deriveWarmth } from "@/lib/deriveWarmth";
import {
  normalizeClothingType,
  deriveClothingType,
  CLOTHING_TYPES,
} from "@/lib/clothingType";

const band = (w: number) => (w < 3 ? "hot" : w < 6 ? "mild" : "cold");

describe("deriveWarmth", () => {
  it("maps clearly warm garments to the cold band", () => {
    for (const name of ["wool parka", "down puffer", "fleece jacket", "chunky sweater", "hoodie"]) {
      expect(band(deriveWarmth({ category: "outer", name }))).toBe("cold");
    }
  });

  it("maps clearly light garments to the hot band", () => {
    for (const name of ["linen tank", "running shorts", "cotton tee", "swim trunks"]) {
      expect(band(deriveWarmth({ category: "top", name }))).toBe("hot");
    }
  });

  it("defaults unknown garments to the mild band", () => {
    expect(deriveWarmth({ category: "bottom", name: "blue jeans" })).toBe(5);
    expect(deriveWarmth({ category: "top", name: "button shirt" })).toBe(5);
    expect(deriveWarmth({})).toBe(5);
  });

  it("does not misfire on 'button-down' (the bare 'down' collision)", () => {
    expect(band(deriveWarmth({ category: "top", name: "button-down oxford" }))).toBe("mild");
    // a real down jacket is still warm (via 'puffer'/'quilted')
    expect(band(deriveWarmth({ name: "quilted down puffer" }))).toBe("cold");
  });

  it("does not misfire on substring collisions (whole-word matching)", () => {
    // "sateen"/"velveteen" contain "tee"; "woolen" contains "wool" — must NOT match.
    expect(band(deriveWarmth({ category: "dress", name: "sateen sheath dress" }))).toBe("mild");
    expect(band(deriveWarmth({ category: "top", name: "velveteen blouse" }))).toBe("mild");
    // but the standalone words still match
    expect(band(deriveWarmth({ name: "cotton tee" }))).toBe("hot");
    expect(band(deriveWarmth({ name: "wool coat" }))).toBe("cold");
  });

  it("checks warm before light when both appear", () => {
    expect(band(deriveWarmth({ name: "fleece shorts" }))).toBe("cold");
  });

  it("recognizes season synonyms (fall/autumn/spring)", () => {
    expect(deriveWarmth({ name: "shirt", seasons: ["fall"] })).toBe(7);
    expect(deriveWarmth({ name: "shirt", seasons: ["autumn"] })).toBe(7);
    expect(deriveWarmth({ name: "shirt", seasons: ["spring"] })).toBe(3);
  });

  it("nudges by declared season when it points one clear way", () => {
    expect(deriveWarmth({ name: "shirt", seasons: ["winter"] })).toBe(7); // 5 + 2
    expect(deriveWarmth({ name: "shirt", seasons: ["summer"] })).toBe(3); // 5 - 2
    expect(deriveWarmth({ name: "shirt", seasons: ["winter", "summer"] })).toBe(5); // conflicting → no nudge
  });

  it("clamps to [0, 10]", () => {
    expect(deriveWarmth({ name: "wool sweater", seasons: ["winter"] })).toBe(10); // 8 + 2 clamped
    expect(deriveWarmth({ name: "tank", seasons: ["summer"] })).toBe(0); // 2 - 2 clamped
  });

  it("always returns an integer in [0, 10]", () => {
    for (const name of ["wool parka", "tank", "jeans", "dress", "sneakers", ""]) {
      const w = deriveWarmth({ name, seasons: ["winter"] });
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(10);
    }
  });
});

describe("normalizeClothingType", () => {
  it.each(CLOTHING_TYPES)("passes through the valid value %s", (t) => {
    expect(normalizeClothingType(t)).toBe(t);
  });

  it("defaults unknown / missing values to top", () => {
    expect(normalizeClothingType("hat")).toBe("top");
    expect(normalizeClothingType(undefined)).toBe("top");
    expect(normalizeClothingType(null)).toBe("top");
    expect(normalizeClothingType(42)).toBe("top");
  });
});

describe("deriveClothingType (the §10.3 ingestion classifier)", () => {
  it("classifies one-piece garments as dress", () => {
    expect(deriveClothingType({ category: "one piece" })).toBe("dress");
    expect(deriveClothingType({ category: "misc", name: "floral romper" })).toBe("dress");
    expect(deriveClothingType({ name: "linen jumpsuit" })).toBe("dress");
  });

  it("classifies bottoms", () => {
    expect(deriveClothingType({ category: "bottom" })).toBe("bottom");
    expect(deriveClothingType({ category: "misc", name: "blue jeans" })).toBe("bottom");
    expect(deriveClothingType({ name: "pleated skirt" })).toBe("bottom");
  });

  it("classifies footwear as shoes", () => {
    expect(deriveClothingType({ category: "footwear" })).toBe("shoes");
    expect(deriveClothingType({ category: "misc", name: "white sneakers" })).toBe("shoes");
    expect(deriveClothingType({ name: "leather boots" })).toBe("shoes");
  });

  it("classifies outerwear as outer_layer (layerRole or clear names)", () => {
    expect(deriveClothingType({ category: "top", layerRole: "outer" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "wool overcoat" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "denim jacket" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "navy blazer" })).toBe("outer_layer");
  });

  it("collapses mid-layer knits to top unless layerRole==outer wins", () => {
    expect(deriveClothingType({ name: "chunky cardigan" })).toBe("top");
    expect(deriveClothingType({ name: "chunky cardigan", layerRole: "outer" })).toBe("outer_layer");
  });

  it("classifies plain tops and defaults the out-of-ontology to top", () => {
    expect(deriveClothingType({ category: "top", name: "cotton tee" })).toBe("top");
    expect(deriveClothingType({ category: "accessory", name: "silk scarf" })).toBe("top");
    expect(deriveClothingType({})).toBe("top");
  });

  it("does not mis-partition substring collisions (whole-word matching)", () => {
    // "petticoat" contains "coat" but is NOT outerwear → must default to top.
    expect(deriveClothingType({ name: "lace petticoat" })).toBe("top");
    // the compound outerwear we DO want is listed explicitly.
    expect(deriveClothingType({ name: "yellow raincoat" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "khaki trenchcoat" })).toBe("outer_layer");
  });

  it("honors the first-match cascade precedence", () => {
    // dress (rung 1) beats a bottom category (rung 2)
    expect(deriveClothingType({ category: "bottom", name: "wrap dress" })).toBe("dress");
    // shoes (rung 3) beats layerRole=="outer" (rung 4) — the surprising one
    expect(deriveClothingType({ category: "footwear", layerRole: "outer" })).toBe("shoes");
  });

  it("handles closed-compound garments that word-boundary would otherwise miss", () => {
    // name-only (no category) — these regressed to "top" before the compound fix
    expect(deriveClothingType({ name: "black sweatpants" })).toBe("bottom");
    expect(deriveClothingType({ name: "fleece joggers" })).toBe("bottom");
    expect(deriveClothingType({ name: "denim jeggings" })).toBe("bottom");
    expect(deriveClothingType({ name: "navy peacoat" })).toBe("outer_layer");
    // two-word forms already worked
    expect(deriveClothingType({ name: "sweat pants" })).toBe("bottom");
  });
});
