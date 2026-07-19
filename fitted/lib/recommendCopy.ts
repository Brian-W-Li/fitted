/**
 * Friend-facing copy for the /api/recommend surface (F10 / F14 / F15). Pure + unit-tested so the
 * dashboard never (a) leaks an engineer-toned server string to a friend — e.g. the raw structural-lock
 * reject "more than one lock occupies the top slot" (F14) — nor (b) shows a bare "no outfits" with no
 * way forward (F15; the empty-state /wardrobe link is F10, in the dashboard JSX).
 */

export interface RenderFlagsLike {
  notEnoughItems?: boolean;
  insufficientAfterGeneration?: boolean;
  spreadCollapsed?: boolean;
  reasonHint?: string | null;
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

/** The message for a render that surfaced no outfits (F15). Engine prose advice wins when present. */
export function emptyStateMessage(flags: RenderFlagsLike | undefined | null): string {
  const f = flags ?? {};
  const healthy = Boolean(f.notEnoughItems || f.insufficientAfterGeneration);
  if (healthy && f.reasonHint) return f.reasonHint; // genuine advice from the engine
  if (f.reasonHint && MACHINE_REASON_COPY[f.reasonHint]) return MACHINE_REASON_COPY[f.reasonHint];
  if (f.notEnoughItems) {
    return "Your closet needs a few more pieces before the stylist can build a full outfit — add some, then try again.";
  }
  return "No outfits this time. Try a different occasion, or add a few more pieces to your closet.";
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
