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
import { DEGRADED_REASON_HINTS } from "@/lib/mlServiceClient";

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

    // No top, no bottom AND no dress — the top/bottom gap is the genuine structural blocker.
    const both = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      slotCensus: { top: 0, bottom: 0, dress: 0, outer_layer: 1, shoes: 2 },
    });
    expect(both).toMatch(/actually a top or a bottom, fix/);
  });

  it("a DRESS-only closet keeps the census but drops the SHOPPING half of the remedy", () => {
    // The engine sizes its ask as `tops × bottoms + dresses` (fitted_core/sampler.py
    // `candidate_requested`), so dresses alone are structurally buildable — "add a top or a bottom"
    // would invent a gap and send that owner shopping for pieces the stylist never needed.
    // But the DESCRIPTION must survive: zero tops AND zero bottoms alongside several dresses is the
    // signature of everything-filed-as-dress (Zhiyun's skirt typed dress), and the counts are the
    // only place that mislabel becomes visible. Suppressing the whole sentence would blind the very
    // case the census exists to catch — the two-entrance rule in the function's own contract.
    const msg = emptyStateMessage({
      insufficientAfterGeneration: true,
      reasonHint: "we couldn't pull a full look together this time",
      slotCensus: { top: 0, bottom: 0, dress: 3, outer_layer: 0, shoes: 2 },
    });
    // The mislabel entrance stays open, counts and all.
    expect(msg).toMatch(/Right now we can see 0 tops, 0 bottoms, 3 dresses/);
    expect(msg).toMatch(/If any of those is actually a top or a bottom, fix its details/);
    // …but the shopping instruction is gone — nothing is structurally missing.
    expect(msg).not.toMatch(/add one you/);
    // The engine's own advice still rides along.
    expect(msg).toMatch(/couldn't pull a full look together/);
  });

  it("still diagnoses a real gap when dresses coexist with a half-outfit", () => {
    // Tops but no bottoms, plus a dress: the dress is buildable, but adding a bottom unlocks the
    // tops, so the diagnosis remains true and actionable.
    const msg = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      slotCensus: { top: 4, bottom: 0, dress: 1, outer_layer: 0, shoes: 1 },
    });
    expect(msg).toMatch(/actually a bottom, fix/);
  });

  it("says the count is availability-scoped — the census counts only AVAILABLE items", () => {
    // `lib/mlRecommend.ts` reads the wardrobe with `isAvailable: { $ne: false }`, so a friend who
    // excluded all their tops sees "0 tops" for a closet that HAS tops. Without the scope sentence the
    // copy offers only two remedies, both of which fail in that case: fix a mislabel (nothing is
    // mislabelled) or buy a top (they own three). Dropping it re-strands exactly that friend.
    const msg = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      slotCensus: { top: 0, bottom: 2, dress: 0, outer_layer: 0, shoes: 1 },
    });
    // The guarantee lives in a SCOPE sentence, not in the mislabel clause: anything counted is by
    // construction not switched off, so folding it into "if one of these is actually a top…" would be a
    // false antecedent that never reaches this friend (a first attempt did exactly that).
    expect(msg).toMatch(/only includes pieces switched on for recommendations/);
    // The false-antecedent shape must not come back.
    expect(msg).not.toMatch(/one of these is actually a top, check whether/i);
    // …and it stays anti-guilt (§18) while doing so.
    expect(msg).not.toMatch(/you haven.{0,2}t|you didn.{0,2}t|yet to add/i);
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

  it("clamps hostile census values (negative/NaN/non-number) to 0 — never a '-1 tops' absurdity", () => {
    const msg = emptyStateMessage({
      notEnoughItems: true,
      reasonHint: "x",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slotCensus: { top: -1, bottom: NaN, dress: "2", outer_layer: 1, shoes: undefined } as any,
    });
    // top clamps to 0 → the top/bottom gap fires; every invalid count reads as 0, the valid layer count survives
    expect(msg).toMatch(/^Right now we can see 0 tops, 0 bottoms, 0 dresses, 1 layer, and 0 pairs of shoes/);
    expect(msg).not.toMatch(/-1|NaN/);
  });
});

describe("MACHINE_REASON_COPY covers every machine hint a render can carry", () => {
  // Two producers feed `flags.reasonHint` with all-healthy-flags-false, and NOTHING pinned that each
  // has copy. A code without an entry falls through `emptyStateMessage` to the generic
  // "…or add a few more pieces to your closet" line — blaming a friend's closet for a service outage.
  it("has friendly copy for every DegradedReasonHint (lib/mlServiceClient)", () => {
    // Enumerated from the runtime array the type is derived from, so adding a fifth code reddens here
    // instead of silently shipping without copy.
    for (const code of DEGRADED_REASON_HINTS) {
      expect(typeof MACHINE_REASON_COPY[code]).toBe("string");
      expect(MACHINE_REASON_COPY[code].length).toBeGreaterThan(0);
      // And it must actually be USED — not merely present in the map.
      expect(emptyStateMessage({ reasonHint: code })).toBe(MACHINE_REASON_COPY[code]);
    }
  });

  it("has friendly copy for `engine_failure` (the replay path's derived hint)", () => {
    // The one machine hint outside the DegradedReasonHint union: `lib/mlSnapshotMerge.ts`
    // `flagsFromDoc` derives it for stored engine-failure rows on the §C.4 replay path.
    expect(emptyStateMessage({ reasonHint: "engine_failure" })).toBe(MACHINE_REASON_COPY.engine_failure);
    expect(MACHINE_REASON_COPY.engine_failure).not.toMatch(/closet|add a few|pieces/i);
  });

  it("an UNKNOWN machine code still avoids blaming the closet as its first move", () => {
    // Documents the residual honestly rather than pretending it away: an unmapped code lands on the
    // generic empty-state line, which does mention the closet. The two pins above are what keep the
    // known codes off that path; a NEW code added upstream without copy would land there.
    expect(emptyStateMessage({ reasonHint: "some_new_code_2027" })).toMatch(/no outfits this time/i);
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
