import { lintOutfit, lintBatch, type LintItem } from "@/lib/outfitLint";

const it_ = (clothingType: string, name: string): LintItem => ({ clothingType, name });

describe("outfitLint — mechanical absurdity checker", () => {
  test("a clean, sane outfit produces no findings", () => {
    const out = lintOutfit([
      it_("top", "White Cotton T-Shirt"),
      it_("bottom", "Blue Denim Jeans"),
      it_("shoes", "White Sneakers"),
    ]);
    expect(out).toEqual([]);
  });

  test("all-black minimal outfit is NOT flagged (no false positive on monochrome)", () => {
    const out = lintOutfit([
      it_("top", "Black Crew T-Shirt"),
      it_("bottom", "Black Slim Jeans"),
      it_("shoes", "Black Chelsea Boots"),
    ]);
    expect(out).toEqual([]);
  });

  test("two bottoms is flagged", () => {
    const out = lintOutfit([it_("bottom", "Jeans"), it_("bottom", "Chinos"), it_("shoes", "Sneakers")]);
    expect(out.map((f) => f.rule)).toContain("two-bottoms");
  });

  test("a dress worn with separates is flagged", () => {
    const out = lintOutfit([it_("dress", "Red Slip Dress"), it_("bottom", "Jeans")]);
    expect(out.map((f) => f.rule)).toContain("dress-with-separates");
  });

  test("a dress alone with shoes is clean", () => {
    const out = lintOutfit([it_("dress", "Floral Midi Dress"), it_("shoes", "Sandals")]);
    expect(out).toEqual([]);
  });

  test("no bottom and no dress is flagged", () => {
    const out = lintOutfit([it_("top", "Sweater"), it_("shoes", "Boots")]);
    expect(out.map((f) => f.rule)).toContain("no-bottom");
  });

  test("two pairs of shoes is flagged", () => {
    const out = lintOutfit([it_("top", "Tee"), it_("bottom", "Jeans"), it_("shoes", "Sneakers"), it_("shoes", "Boots")]);
    expect(out.map((f) => f.rule)).toContain("two-shoes");
  });

  test("REGRESSION: gym hoodie + suit trousers (the real 2026-07-18 gauntlet finding) is a formality-clash", () => {
    const out = lintOutfit([
      it_("top", "Gray Gym Hoodie"),
      it_("bottom", "Charcoal Suit Trousers"),
      it_("shoes", "White Running Shoes"),
    ]);
    expect(out.map((f) => f.rule)).toContain("formality-clash");
  });

  test("running shoes + tuxedo is a formality-clash", () => {
    const out = lintOutfit([it_("top", "Tuxedo Jacket"), it_("bottom", "Tuxedo Trousers"), it_("shoes", "Running Shoes")]);
    expect(out.map((f) => f.rule)).toContain("formality-clash");
  });

  test("a fully formal business outfit is NOT a formality-clash (no athletic signal)", () => {
    const out = lintOutfit([
      it_("top", "White Dress Shirt"),
      it_("bottom", "Charcoal Suit Trousers"),
      it_("outer_layer", "Navy Blazer"),
      it_("shoes", "Black Oxford Dress Shoes"),
    ]);
    expect(out).toEqual([]);
  });

  test("shorts with a parka is flagged", () => {
    const out = lintOutfit([it_("top", "Tee"), it_("bottom", "Athletic Shorts"), it_("outer_layer", "Winter Parka"), it_("shoes", "Sneakers")]);
    expect(out.map((f) => f.rule)).toContain("shorts-with-heavy-coat");
  });

  test("lintBatch rolls up per-rule counts and only lists outfits with findings", () => {
    const report = lintBatch([
      { label: "clean", items: [it_("top", "Tee"), it_("bottom", "Jeans"), it_("shoes", "Sneakers")] },
      { label: "clash", items: [it_("top", "Gym Hoodie"), it_("bottom", "Suit Trousers"), it_("shoes", "Sneakers")] },
    ]);
    expect(report.total).toBe(2);
    expect(report.withFindings).toBe(1);
    expect(report.byRule["formality-clash"]).toBe(1);
    expect(report.findings[0].label).toBe("clash");
  });
});
