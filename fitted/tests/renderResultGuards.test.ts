/**
 * Truth table for the re-roll no-wipe veto predicate (Track 2 Lane D). Honest scope: this pins
 * the CONDITION both dashboard call sites share; the `accepted === false` veto wiring inside the
 * dashboard's runRender is client-component code with no render-test infra — covered manually
 * (runbook §8 E2E), registered as the client-test-infra decision in the campaign tracker.
 */
import { isEmptyDegradedRender } from "@/lib/renderResultGuards";

describe("isEmptyDegradedRender — the re-roll no-wipe veto condition", () => {
  it("vetoes only the nothing-to-show degradation", () => {
    // bindable + shown → a healthy render: never veto.
    expect(isEmptyDegradedRender({ bindable: true, shown: [{}] })).toBe(false);
    // degraded + empty → the wipe case the veto exists for.
    expect(isEmptyDegradedRender({ bindable: false, shown: [] })).toBe(true);
    // degraded but PARTIAL results → show them, don't veto.
    expect(isEmptyDegradedRender({ bindable: false, shown: [{}] })).toBe(false);
    // bindable but empty (a valid empty render, e.g. notEnoughItems) → not a degradation.
    expect(isEmptyDegradedRender({ bindable: true, shown: [] })).toBe(false);
  });

  it("treats a missing/null shown array as empty", () => {
    expect(isEmptyDegradedRender({ bindable: false })).toBe(true);
    expect(isEmptyDegradedRender({ bindable: false, shown: null })).toBe(true);
    expect(isEmptyDegradedRender({ bindable: true })).toBe(false);
  });
});
