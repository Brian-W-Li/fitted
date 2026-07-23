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
  SHOE_KEYWORDS,
  BOTTOM_KEYWORDS,
  OUTER_KEYWORDS,
  DRESS_MODIFIER_EXTRA,
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
    expect(deriveClothingType({ name: "olive cargos" })).toBe("bottom"); // the UI Type option
  });

  it("does NOT let the cargos keyword steal outerwear (bottom rung runs before outer)", () => {
    // A bare "cargo" keyword would classify these as bottom — the rung-order trap the
    // plural-only rule exists for.
    expect(deriveClothingType({ name: "Cargo Jacket" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "cargo parka" })).toBe("outer_layer");
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
    // a structural bottom category (rung 2) beats a bare-dress NAME (rung 5) — the deliberate
    // INVERSION of the old "name beats a coarse category" rule (the "suit dress" fix)
    expect(deriveClothingType({ category: "bottom", name: "wrap dress" })).toBe("bottom");
    // shoes (rung 3) beats layerRole=="outer" (rung 4) — the surprising one
    expect(deriveClothingType({ category: "footwear", layerRole: "outer" })).toBe("shoes");
  });

  it("lets structural signals beat the bare-dress guess (the 'suit dress' mis-slot fix)", () => {
    // the live Zhiyun row: a suit-set SKIRT whose set-name leaked "dress" — her only bottom,
    // silently blinding the engine (docs/plans/clothingtype-slot-correctness.md §1/§2)
    expect(
      deriveClothingType({ category: "bottom", subCategory: "skirt", name: "suit dress" }),
    ).toBe("bottom");
    // name-only "suit dress" is genuinely unresolvable → the bare-dress guess stands (plan §3)
    expect(deriveClothingType({ name: "suit dress" })).toBe("dress");
    // layerRole is a deliberate human structural choice — beats the bare-dress guess (rung 4 > 5)
    expect(deriveClothingType({ name: "duster dress", layerRole: "outer" })).toBe("outer_layer");
    // but [outer-noun+"dress"] compounds are DRESSES — bare-dress (rung 5) beats the outerwear
    // NAME keywords (rung 6)…
    expect(deriveClothingType({ name: "blazer dress" })).toBe("dress");
    expect(deriveClothingType({ name: "coat dress" })).toBe("dress");
    // …while the adjectival direction stays outerwear (head-noun-last)
    expect(deriveClothingType({ name: "dress coat" })).toBe("outer_layer");
  });

  it("classifies the skirt-adjacent bottom keywords (skort/culottes/capris)", () => {
    expect(deriveClothingType({ name: "cargo skort" })).toBe("bottom");
    expect(deriveClothingType({ name: "pleated culottes" })).toBe("bottom");
    expect(deriveClothingType({ name: "linen capris" })).toBe("bottom");
    // "dress <new-noun>" lands on bottom (rung 2 beats the bare-dress rung; the derived
    // adjectival guard also grows these nouns — belt-and-braces, covered by the it.each below)
    expect(deriveClothingType({ name: "dress capris" })).toBe("bottom");
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

  it("does not let an adjectival 'dress' hijack the real garment", () => {
    // "Dress Shoes" is a literal footwear subcategory in the upload form — must be shoes.
    expect(
      deriveClothingType({ category: "footwear", subCategory: "dress shoes", name: "Oxford Dress Shoes" }),
    ).toBe("shoes");
    expect(deriveClothingType({ name: "dress shoes" })).toBe("shoes");
    // the noun set covers the whole footwear rung (not just "shoes")
    expect(deriveClothingType({ category: "footwear", name: "white dress sneakers" })).toBe("shoes");
    expect(deriveClothingType({ name: "dress boots" })).toBe("shoes");
    // a hyphen separator reads like a space (keywordMatch hyphen-as-boundary convention)
    expect(deriveClothingType({ category: "footwear", name: "dress-shoes" })).toBe("shoes");
    // other adjectival-"dress" compounds route to their real type, not "dress"
    expect(deriveClothingType({ category: "top", name: "blue dress shirt" })).toBe("top");
    expect(deriveClothingType({ name: "grey dress pants" })).toBe("bottom");
    expect(deriveClothingType({ name: "pleated dress skirt" })).toBe("bottom");
    expect(deriveClothingType({ name: "wool dress coat" })).toBe("outer_layer");
    expect(deriveClothingType({ name: "black dress socks" })).toBe("top");
  });

  it("partitions an unambiguous bottom noun ('slacks') to bottom, not top", () => {
    // "slacks" is unambiguously trousers — it belongs in the bottom rung, not just the
    // adjectival-modifier set, so a bare "wool slacks" item partitions correctly.
    expect(deriveClothingType({ name: "grey slacks" })).toBe("bottom");
    expect(deriveClothingType({ name: "wool slacks" })).toBe("bottom");
    expect(deriveClothingType({ name: "dress slacks" })).toBe("bottom");
  });

  it("still classifies a genuine 'dress' (head noun) as dress", () => {
    // "dress" as the head noun with NO structural signal stays a one-piece — the name-only
    // case, resolved at the bare-dress rung. (The miscategorized cat=bottom variant now
    // deliberately inverts to bottom — see the precedence test above.)
    expect(deriveClothingType({ name: "wrap dress" })).toBe("dress");
    expect(deriveClothingType({ name: "shirt dress" })).toBe("dress");
    expect(deriveClothingType({ name: "sweater dress" })).toBe("dress");
    expect(deriveClothingType({ name: "maxi dress" })).toBe("dress");
  });

  it("classifies closed-compound / synonym one-pieces the bare 'dress' boundary misses", () => {
    // "sundress" has no \bdress\b boundary inside it (like the bottoms rung's "sweatpants").
    expect(deriveClothingType({ name: "floral sundress" })).toBe("dress");
    expect(deriveClothingType({ name: "evening gown" })).toBe("dress");
    expect(deriveClothingType({ name: "tweed frock" })).toBe("dress");
  });

  // Drift guard: the adjectival-"dress" exclusion is derived from these rung arrays, so a
  // keyword added to any rung is automatically a noun "dress" can modify. This asserts the
  // invariant directly — if the derivation is ever broken, "dress <rung-noun>" → "dress"
  // would resurface the "Dress Shoes → dress" footgun and fail loudly here.
  it.each([...SHOE_KEYWORDS, ...BOTTOM_KEYWORDS, ...OUTER_KEYWORDS, ...DRESS_MODIFIER_EXTRA])(
    "never lets adjectival 'dress %s' collapse to a one-piece dress",
    (kw) => {
      expect(deriveClothingType({ name: `dress ${kw}` })).not.toBe("dress");
    },
  );
});
