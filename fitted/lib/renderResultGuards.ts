/**
 * The re-roll no-wipe veto predicate (shared by the dashboard's submitRegenerate and
 * resumePending callbacks): a degraded/EMPTY render — rate-limited, outage, nothing buildable
 * under the locks — must not replace the outfits the user is looking at, nor overwrite the
 * persisted copy. Extracted so the condition is a single unit under test; the `accepted ===
 * false` veto WIRING in the dashboard's runRender is client-component code and is NOT covered
 * by the predicate's truth-table test.
 *
 * A degraded-but-shown render (partial results) and a bindable-but-empty one (a valid empty
 * daily render, e.g. notEnoughItems on a root request) are both NOT vetoed — the veto is only
 * for the nothing-to-show degradation that would wipe a good screen.
 */
export function isEmptyDegradedRender(r: {
  bindable: boolean;
  shown?: readonly unknown[] | null;
}): boolean {
  return !r.bindable && (r.shown?.length ?? 0) === 0;
}
