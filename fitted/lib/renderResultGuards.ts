/**
 * The re-roll no-wipe veto predicate (shared by the dashboard's submitRegenerate and
 * resumePending callbacks): a degraded/EMPTY render — rate-limited, outage, nothing buildable
 * under the locks — must not replace the outfits the user is looking at, nor overwrite the
 * persisted copy. Extracted so the condition is a single unit under test; the `accepted ===
 * false` veto WIRING in the dashboard's runRender is client-component code and is NOT covered
 * by the predicate's truth-table test.
 *
 * A degraded-but-shown render (partial results) is NOT vetoed. Note "bindable-but-empty" is an
 * impossible state (bindable ⇔ nSurfaced>0 ⇔ shown non-empty — the mlSnapshotMerge projection),
 * so EVERY empty render is vetoed — including a valid notEnoughItems empty on a re-roll, which
 * is correct: the old screen is kept and the empty-state hint shows in the error slot.
 */
export function isEmptyDegradedRender(r: {
  bindable: boolean;
  shown?: readonly unknown[] | null;
}): boolean {
  return !r.bindable && (r.shown?.length ?? 0) === 0;
}
