/**
 * Friend-facing copy for the /api/recommend surface (F10 / F14 / F15). Pure + unit-tested so the
 * dashboard never (a) leaks an engineer-toned server string to a friend — e.g. the raw structural-lock
 * reject "more than one lock occupies the top slot" (F14) — nor (b) shows a bare "no outfits" with no
 * way forward (F15; the empty-state /wardrobe link is F10, in the dashboard JSX).
 */

import { CLOTHING_TYPES, type ClothingType } from "@/lib/clothingType";

export interface RenderFlagsLike {
  notEnoughItems?: boolean;
  insufficientAfterGeneration?: boolean;
  spreadCollapsed?: boolean;
  reasonHint?: string | null;
  /** D1 per-slot closet census — live renders only (see BrowserFlags in mlSnapshotMerge). */
  slotCensus?: Partial<Record<ClothingType, number>> | null;
}

/** D1 dual-remedy census sentence (clothingtype-slot-correctness §4-D). Emitted only when the
 *  census shows a structural gap the friend can act on (zero tops or zero bottoms — the two slots
 *  every two-piece outfit needs); otherwise the engine hint stands alone. The wall has TWO
 *  entrances — a mislabeled item (Zhiyun's skirt typed dress) and a genuinely absent slot — so the
 *  remedy names both: fix a mislabel in the Wardrobe, or add the missing piece. Anti-guilt (§18):
 *  honest description of what WE see, never "you haven't added…". */
function slotCensusSentence(census: RenderFlagsLike["slotCensus"]): string | null {
  if (!census) return null;
  const n = (t: ClothingType) => {
    const v = census[t];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const tops = n("top");
  const bottoms = n("bottom");
  if (tops > 0 && bottoms > 0) return null; // no top/bottom gap — a census sentence would be a false premise
  // A fully-empty closet needs no diagnosis ("if one of these…" would have no referent) — the
  // base empty-state copy already says to add pieces. Summed over the enum so a sixth slot value
  // could never silently escape the emptiness check.
  if (CLOTHING_TYPES.reduce((sum, t) => sum + n(t), 0) === 0) return null;
  const count = (v: number, singular: string, plural = `${singular}s`) =>
    `${v} ${v === 1 ? singular : plural}`;
  const description =
    `Right now we can see ${count(tops, "top")}, ${count(bottoms, "bottom")}, ` +
    `${count(n("dress"), "dress", "dresses")}, ${count(n("outer_layer"), "layer")}, and ` +
    `${count(n("shoes"), "pair of shoes", "pairs of shoes")} in your closet.`;
  const missing =
    tops === 0 && bottoms === 0 ? "a top or a bottom" : bottoms === 0 ? "a bottom" : "a top";
  return `${description} If one of these is actually ${missing}, fix its details in your Wardrobe — or add one you don’t have yet.`;
}

/** Machine reason codes a DEGRADED render carries in `reasonHint` (all healthy flags false) → friendly
 *  copy. An unrecognized code falls through to the generic empty-state line. */
export const MACHINE_REASON_COPY: Record<string, string> = {
  service_unavailable: "The stylist is temporarily unavailable. Please try again in a moment.",
  contract_invalid: "We couldn't build a request from that input. Try rephrasing the occasion.",
  // Two ceilings share this: the global service bucket (someone else's traffic can trip it) and the
  // per-user pacer — non-blaming, honest about the up-to-a-minute wait.
  rate_limited: "The stylist is busy right now — try again in a minute.",
  // The SERVICE key handshake failing (an ops misconfig), not the user's session — "sign in again"
  // would send them on a futile loop.
  auth_failed: "The stylist is temporarily unavailable. Please try again later.",
  engine_failure: "Something went wrong generating outfits. Please try again.",
};

/** The message for a render that surfaced no outfits (F15). Engine prose advice wins when present.
 *  On HEALTHY empties the D1 census sentence is composed BEFORE the base message (it must ride the
 *  engine-hint branch — the engine always sets `reasonHint` on the empties D1 targets, so a census
 *  bolted onto the later fallbacks alone would never be reached). Machine-degraded states never get
 *  the census: closet counts would misdiagnose a service outage as a closet problem. */
export function emptyStateMessage(flags: RenderFlagsLike | undefined | null): string {
  const f = flags ?? {};
  const healthy = Boolean(f.notEnoughItems || f.insufficientAfterGeneration);
  const census = healthy ? slotCensusSentence(f.slotCensus) : null;
  let base: string;
  if (healthy && f.reasonHint) {
    base = f.reasonHint; // genuine advice from the engine
  } else if (f.reasonHint && MACHINE_REASON_COPY[f.reasonHint]) {
    return MACHINE_REASON_COPY[f.reasonHint];
  } else if (f.notEnoughItems) {
    base = "Your closet needs a few more pieces before the stylist can build a full outfit — add some, then try again.";
  } else {
    base = "No outfits this time. Try a different occasion, or add a few more pieces to your closet.";
  }
  // Capitalize the base's first letter when it follows the census sentence — the engine's hints
  // are lowercase fragments, fine standalone but a typo-looking joint mid-paragraph.
  return census ? `${census} ${base.charAt(0).toUpperCase()}${base.slice(1)}` : base;
}

/** A partial render (1–2 shown, not zero) can still carry an "insufficient" note (F16). Returns the
 *  hint to show ABOVE the cards, or null when the render is a clean full set. */
export function partialRenderHint(flags: RenderFlagsLike | undefined | null, shownCount: number): string | null {
  const f = flags ?? {};
  if (shownCount <= 0) return null; // the empty state owns the zero case
  if (f.insufficientAfterGeneration) {
    return f.reasonHint ?? "We could only pull together a couple of looks this time — more variety in your closet unlocks more options.";
  }
  return null;
}

/** Friendly copy for a HARD 4xx reject (distinct from a degraded render). Unknown codes fall to a
 *  generic line — NEVER the raw server message, which is engineer-toned by design (F14). The dashboard
 *  handles `forced_item_unavailable` + `request_id_conflict` with their own bespoke copy before this. */
const CONTROL_ERROR_COPY: Record<string, string> = {
  controls_structurally_infeasible:
    "Those “keep” picks can’t all go together — keep just one top, one bottom (or one dress), then regenerate.",
  controls_contradictory: "A piece is marked both keep and avoid — clear one of them and try again.",
  control_item_unavailable:
    "One of the pieces you kept or avoided isn’t in your closet anymore. Adjust your picks and try again.",
  control_item_unusable:
    "One of the pieces you kept or avoided is missing some details — edit it in your wardrobe, then try again.",
  forced_item_unusable:
    "The item you’re building around is missing some details — edit it in your wardrobe, or pick a different piece.",
  root_controls: "Something went off with that regenerate — generate a fresh set and try again.",
};

export function recommendErrorMessage(code: string | undefined | null): string {
  if (code && CONTROL_ERROR_COPY[code]) return CONTROL_ERROR_COPY[code];
  return "Couldn’t generate outfits. Please try again.";
}
