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
