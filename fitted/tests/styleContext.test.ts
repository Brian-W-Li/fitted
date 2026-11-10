import { parseStyleSelection, styleSelectionKey, validCapturedStyleContext, sameCapturedStyleContext } from "@/lib/styleContext";
import { preferenceDecisionMessage, projectPreferenceDecision } from "@/lib/stylePreferenceDecision";

const selection = { boardId: "a".repeat(24), profileId: "b".repeat(24), profileVersion: 1,
  routineId: "c".repeat(24), routineVersion: 1, learningEnabled: true };
const context = { ...selection, boardLabel: "Campus", routineLabel: "Class", memoryRevision: 3,
  compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] }, weather: "unspecified" as const };

it("binds command equality to semantic context and opt-in, not renamed display labels or later memory", () => {
  expect(styleSelectionKey(context)).toBe(styleSelectionKey({ ...context, boardLabel: "University", memoryRevision: 9 }));
  expect(styleSelectionKey(context)).not.toBe(styleSelectionKey({ ...context, profileVersion: 2 }));
  expect(styleSelectionKey(context)).not.toBe(styleSelectionKey({ ...context, learningEnabled: false }));
  expect(styleSelectionKey(null)).toBeNull();
});
it("rejects forged profile contents, malformed context references and opt-in without a situation", () => {
  expect(parseStyleSelection({ ...selection, compiled: {} })).toBeNull();
  expect(parseStyleSelection({ ...selection, profileVersion: true })).toBeNull();
  expect(parseStyleSelection({ ...selection, routineId: null, routineVersion: null })).toBeNull();
  expect(parseStyleSelection({ ...selection, routineVersion: null })).toBeNull();
  expect(parseStyleSelection({ ...selection, routineId: null, routineVersion: null, learningEnabled: false })).not.toBeNull();
});
it("compares captured input structurally across service JSON key order and detects changed declarations", () => {
  expect(validCapturedStyleContext(context)).toBe(true);
  expect(sameCapturedStyleContext(context, { ...context, compiled: { fits: [], patterns: [], palette: [], aestheticKeywords: ["relaxed"] } })).toBe(true);
  expect(sameCapturedStyleContext(context, { ...context, memoryRevision: 4 })).toBe(false);
  expect(sameCapturedStyleContext(context, { ...context, compiled: { ...context.compiled, aestheticKeywords: ["formal"] } })).toBe(false);
});
it("shows honest unchanged-set feedback and strips decision internals from browser summaries", () => {
  const raw = { status: "fitted_experimental", reason: "supported", support: 6, likes: 3, dislikes: 3,
    evidenceDigest: "private-audit", baselineShownFullSignatures: ["one", "two"], shownFullSignatures: ["one", "two"] };
  const safe = projectPreferenceDecision(raw)!;
  expect(safe).not.toHaveProperty("evidenceDigest");
  expect(safe).not.toHaveProperty("baselineShownFullSignatures");
  expect(preferenceDecisionMessage(safe, true)).toMatch(/set stayed the same/);
  expect(preferenceDecisionMessage({ ...safe, selectionChanged: true }, true)).toMatch(/helped choose this set/);
  expect(preferenceDecisionMessage(undefined, false)).toMatch(/off/);
  expect(projectPreferenceDecision({ ...raw, support: -1 })).toBeUndefined();
});
