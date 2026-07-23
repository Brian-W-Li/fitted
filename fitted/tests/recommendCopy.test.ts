/**
 * Friend-facing recommend copy (F14 / F15 / F16). Pins that: an engineer-toned server reject never
 * reaches a friend verbatim; the empty state gives a way forward; a partial render can still surface
 * its insufficient hint.
 */
import {
  emptyStateMessage,
  recommendErrorMessage,
  partialRenderHint,
  MACHINE_REASON_COPY,
} from "@/lib/recommendCopy";

describe("recommendErrorMessage (F14 — no engineer-tone leak)", () => {
  it("maps the structural-lock reject to friendly, actionable copy", () => {
    const msg = recommendErrorMessage("controls_structurally_infeasible");
    expect(msg).toMatch(/keep just one top/i);
    expect(msg).not.toMatch(/slot|occupies|coexist/i); // never the raw engine string
  });

  it("maps the whole control/lock family (never falls through to a raw server message)", () => {
    for (const code of [
      "controls_contradictory",
      "control_item_unavailable",
      "control_item_unusable",
      "forced_item_unusable",
      "root_controls",
    ]) {
      expect(recommendErrorMessage(code).length).toBeGreaterThan(0);
      expect(recommendErrorMessage(code)).not.toBe(recommendErrorMessage("__unknown__"));
    }
  });

  it("an unknown/undefined code falls to a generic friendly line, not a raw string", () => {
    expect(recommendErrorMessage(undefined)).toMatch(/try again/i);
    expect(recommendErrorMessage("weird_internal_code")).toMatch(/try again/i);
  });
});

describe("emptyStateMessage (F15)", () => {
  it("prefers the engine's prose advice on a healthy insufficient render", () => {
    expect(emptyStateMessage({ notEnoughItems: true, reasonHint: "Add a pair of shoes." })).toBe("Add a pair of shoes.");
  });

  it("maps a degraded machine reasonHint to friendly copy", () => {
    expect(emptyStateMessage({ reasonHint: "rate_limited" })).toBe(MACHINE_REASON_COPY.rate_limited);
  });

  it("gives a way-forward line for notEnoughItems with no hint", () => {
    expect(emptyStateMessage({ notEnoughItems: true })).toMatch(/few more pieces/i);
  });

  it("never throws on a shape-shifted / missing flags object", () => {
    expect(emptyStateMessage(undefined)).toMatch(/no outfits/i);
    expect(emptyStateMessage(null)).toMatch(/no outfits/i);
  });
});

describe("emptyStateMessage — D1 slot census (dual-remedy, clothingtype-slot-correctness §4-D)", () => {
  const bottomless = { top: 5, bottom: 0, dress: 1, outer_layer: 1, shoes: 0 };

  it("composes the census INTO the engine-hint branch (the hint alone would hide the diagnosis)", () => {
    const msg = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "add a bottom to build an outfit around this top",
      slotCensus: bottomless,
    });
    // honest description first, then BOTH remedies, then the engine hint (first letter
    // capitalized by the composer — the engine's fragments are lowercase)
    expect(msg).toMatch(/^Right now we can see 5 tops, 0 bottoms, 1 dress, 1 layer, and 0 pairs of shoes/);
    expect(msg).toMatch(/actually a bottom, fix its details in your Wardrobe/);
    expect(msg).toMatch(/Add a bottom to build an outfit around this top$/);
  });

  it("rides the insufficientAfterGeneration empty branch too (both empties carry a hint)", () => {
    const msg = emptyStateMessage({
      insufficientAfterGeneration: true,
      reasonHint: "add a few more items to pair it with",
      slotCensus: bottomless,
    });
    expect(msg).toMatch(/^Right now we can see/);
    expect(msg).toMatch(/Add a few more items to pair it with$/);
  });

  it("still composes on a healthy empty with NO engine hint (belt-and-braces fallbacks)", () => {
    const msg = emptyStateMessage({ notEnoughItems: true, slotCensus: bottomless });
    expect(msg).toMatch(/^Right now we can see/);
    expect(msg).toMatch(/few more pieces/i);
  });

  it("no top/bottom gap → no census sentence (a false-premise diagnosis is worse than none)", () => {
    const msg = emptyStateMessage({
      insufficientAfterGeneration: true,
      reasonHint: "add a few more items to pair it with",
      slotCensus: { top: 2, bottom: 1, dress: 0, outer_layer: 0, shoes: 0 },
    });
    expect(msg).toBe("add a few more items to pair it with");
  });

  it("census absent (the replay/dedup paths) → the plain engine hint, unchanged", () => {
    expect(
      emptyStateMessage({ notEnoughItems: true, reasonHint: "add a bottom to build an outfit around this top" }),
    ).toBe("add a bottom to build an outfit around this top");
  });

  it("NEVER decorates a machine-degraded state (an outage is not a closet problem)", () => {
    const msg = emptyStateMessage({ reasonHint: "service_unavailable", slotCensus: bottomless });
    expect(msg).toBe(MACHINE_REASON_COPY.service_unavailable);
  });

  it("names the right missing slot, with honest singulars/plurals", () => {
    const topless = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      slotCensus: { top: 0, bottom: 1, dress: 2, outer_layer: 0, shoes: 1 },
    });
    expect(topless).toMatch(/0 tops, 1 bottom, 2 dresses, 0 layers, and 1 pair of shoes/);
    expect(topless).toMatch(/actually a top, fix/);

    const both = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      slotCensus: { top: 0, bottom: 0, dress: 2, outer_layer: 0, shoes: 0 },
    });
    expect(both).toMatch(/actually a top or a bottom, fix/);
  });

  it("a fully-empty closet gets NO census ('one of these' would have no referent)", () => {
    const msg = emptyStateMessage({
      notEnoughItems: true,
      slotCensus: { top: 0, bottom: 0, dress: 0, outer_layer: 0, shoes: 0 },
    });
    expect(msg).toMatch(/few more pieces/i);
    expect(msg).not.toMatch(/Right now we can see/);
  });

  it("anti-guilt trap-guard (§18): describes what WE see, never what the friend hasn't done", () => {
    const msg = emptyStateMessage({ notEnoughItems: true, reasonHint: "x", slotCensus: bottomless });
    // apostrophe-agnostic (straight OR typographic) so a future curly "you haven’t" can't slip the guard
    expect(msg).not.toMatch(/you haven.{0,2}t|you didn.{0,2}t|yet to add/i);
    expect(msg).toMatch(/^Right now we can see/);
  });
});

describe("partialRenderHint (F16)", () => {
  it("surfaces the insufficient hint on a NON-empty partial render", () => {
    expect(partialRenderHint({ insufficientAfterGeneration: true }, 2)).toMatch(/more variety|couple of looks/i);
    expect(partialRenderHint({ insufficientAfterGeneration: true, reasonHint: "Add outerwear." }, 1)).toBe("Add outerwear.");
  });

  it("returns null on a clean full render and on the empty (zero) case", () => {
    expect(partialRenderHint({}, 3)).toBeNull();
    expect(partialRenderHint({ insufficientAfterGeneration: true }, 0)).toBeNull();
  });
});
