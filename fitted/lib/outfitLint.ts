/**
 * Outfit-lint — a deterministic checker for MECHANICAL absurdities in a rendered outfit (Track 2
 * content-quality guard). It answers "is this outfit structurally wrong / mockable?" — NOT "is it
 * stylish?" (taste is the friend's dislike signal, not a lint rule). It exists so content keeps being
 * audited AFTER friends arrive: run it over every rendered candidate (live snapshots or the M6 export)
 * and a regression in stylist quality shows up as a rising lint-hit rate instead of going unnoticed.
 *
 * The server-side validator (fitted_core) already makes most of these unreachable in a WELL-FORMED
 * render; this is the INDEPENDENT monitor (CLAUDE.md "enforce with CI-shaped artifacts, not
 * discipline") — a second, cheaper pair of eyes that also runs over historical corpus data the
 * validator never re-checks, and catches stylist-prompt drift the schema can't (e.g. a formality
 * clash is schema-valid but mockable).
 *
 * Pure + deterministic: no clock, no I/O. Operates on a normalized outfit (the minimum both the live
 * browser response and the export can produce). Reference: docs/plans/track2-friend-ready-2026-07-18.md.
 */

export type OutfitLintClothingType = "top" | "bottom" | "shoes" | "outer_layer" | "dress";

/** The minimum an outfit item must expose to be lintable — both `shown[].displayItems` (live) and the
 *  M6 export item join can produce this shape. */
export interface LintItem {
  clothingType: OutfitLintClothingType | string;
  name: string;
}

export interface LintFinding {
  /** kebab-case rule id (stable — dashboards/tests key on it). */
  rule: string;
  /** human-readable one-liner naming the offending items. */
  message: string;
  /** the item names implicated, for triage. */
  items: string[];
}

// ---------------------------------------------------------------------------
// Keyword signals. Whole-word-ish matching over the lowercased name. Kept deliberately small +
// high-precision: a false lint hit (crying wolf on a fine outfit) is worse than a miss, because the
// point is a trustworthy rising-rate signal, not exhaustive taste policing.
// ---------------------------------------------------------------------------
const ATHLETIC = ["gym", "athletic", "running", "track pant", "track pants", "sweatpant", "jogger", "basketball short", "workout"];
const FORMAL = ["suit", "tuxedo", "dress shirt", "dress pant", "dress trouser", "oxford", "gown", "blazer", "sport coat"];
// Heavy cold-weather outerwear that clashes with warm-weather bottoms.
const HEAVY_OUTERWEAR = ["parka", "overcoat", "puffer", "down jacket", "winter coat", "wool coat", "heavy coat"];
const WARM_BOTTOM = ["shorts"];

// Whole-word matching (mirrors lib/keywordMatch's doctrine) so a signal word can't be caught inside a
// larger word — "shorts" must NOT fire on "short sleeve shirt", "coat" must NOT fire on "petticoat".
// A false lint hit is worse than a miss (the point is a trustworthy rising-rate signal), so precision
// wins over recall here. Multi-word phrases ("dress shirt", "winter coat") still match verbatim.
function mentions(name: string, words: string[]): boolean {
  const h = ` ${(name ?? "").toLowerCase()} `;
  return words.some((w) => {
    const esc = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`).test(h);
  });
}

/**
 * Lint one outfit. Returns every finding (possibly empty). An outfit is the full set of items in one
 * rendered candidate.
 */
export function lintOutfit(items: LintItem[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const names = items.map((i) => i.name);
  const typeOf = (i: LintItem) => String(i.clothingType);

  const bottoms = items.filter((i) => typeOf(i) === "bottom");
  const dresses = items.filter((i) => typeOf(i) === "dress");
  const tops = items.filter((i) => typeOf(i) === "top");
  const shoes = items.filter((i) => typeOf(i) === "shoes");

  // 1. Two lower-body pieces — you cannot wear two pairs of pants.
  if (bottoms.length > 1) {
    findings.push({ rule: "two-bottoms", message: `two bottom-slot items: ${bottoms.map((b) => b.name).join(", ")}`, items: bottoms.map((b) => b.name) });
  }
  // 2. Two dresses / a dress with a top or bottom — the one-piece slot is exclusive (mirrors the
  //    server structural rule; here as the independent monitor over historical data).
  if (dresses.length > 1) {
    findings.push({ rule: "two-dresses", message: `two dresses: ${dresses.map((d) => d.name).join(", ")}`, items: dresses.map((d) => d.name) });
  }
  if (dresses.length >= 1 && (bottoms.length >= 1 || tops.length >= 1)) {
    const clashers = [...dresses, ...bottoms, ...tops].map((i) => i.name);
    findings.push({ rule: "dress-with-separates", message: `a dress worn with a top/bottom: ${clashers.join(", ")}`, items: clashers });
  }
  // 3. No lower-body coverage at all — a top + shoes with no bottom and no dress is not an outfit.
  if (dresses.length === 0 && bottoms.length === 0 && (tops.length > 0 || shoes.length > 0)) {
    findings.push({ rule: "no-bottom", message: `outfit has no bottom and no dress: ${names.join(", ")}`, items: names });
  }
  // 4. Two pairs of shoes.
  if (shoes.length > 1) {
    findings.push({ rule: "two-shoes", message: `two pairs of shoes: ${shoes.map((s) => s.name).join(", ")}`, items: shoes.map((s) => s.name) });
  }
  // 5. Formality clash — an athletic-signal item worn with a formal-signal item (gym hoodie + suit
  //    trousers; running shoes + tuxedo). Schema-valid but mockable; the content-drift canary.
  const athleticItems = items.filter((i) => mentions(i.name, ATHLETIC));
  const formalItems = items.filter((i) => mentions(i.name, FORMAL));
  if (athleticItems.length > 0 && formalItems.length > 0) {
    const clashers = [...new Set([...athleticItems, ...formalItems].map((i) => i.name))];
    findings.push({ rule: "formality-clash", message: `athletic + formal in one outfit: ${clashers.join(", ")}`, items: clashers });
  }
  // 6. Weather absurdity — warm-weather bottom (shorts) with heavy cold-weather outerwear.
  const shortsItems = items.filter((i) => mentions(i.name, WARM_BOTTOM));
  const heavyItems = items.filter((i) => mentions(i.name, HEAVY_OUTERWEAR));
  if (shortsItems.length > 0 && heavyItems.length > 0) {
    const clashers = [...new Set([...shortsItems, ...heavyItems].map((i) => i.name))];
    findings.push({ rule: "shorts-with-heavy-coat", message: `shorts with heavy outerwear: ${clashers.join(", ")}`, items: clashers });
  }
  return findings;
}

export interface OutfitLintReport {
  total: number;
  withFindings: number;
  byRule: Record<string, number>;
  findings: Array<{ index: number; label?: string; findings: LintFinding[] }>;
}

/** Lint a batch of outfits and roll up a report (for the gauntlet runner + a post-friend monitor). */
export function lintBatch(outfits: Array<{ items: LintItem[]; label?: string }>): OutfitLintReport {
  const byRule: Record<string, number> = {};
  const findings: OutfitLintReport["findings"] = [];
  let withFindings = 0;
  outfits.forEach((o, index) => {
    const f = lintOutfit(o.items);
    if (f.length > 0) {
      withFindings += 1;
      for (const x of f) byRule[x.rule] = (byRule[x.rule] ?? 0) + 1;
      findings.push({ index, label: o.label, findings: f });
    }
  });
  return { total: outfits.length, withFindings, byRule, findings };
}
