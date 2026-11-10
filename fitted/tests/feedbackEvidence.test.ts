import { resolveFeedbackEvidence } from "@/lib/feedbackEvidence.cjs";
import { pickLatestPerCandidate as pickHistory } from "@/lib/latestFeedbackState";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pickLatestPerCandidate: pickExport } = require("../scripts/exportTrack2Core.cjs") as typeof import("../scripts/exportTrack2Core.cjs");

const vote = {
  _id: "vote", user: "owner", snapshotId: "snapshot", candidateId: "candidate", baseKey: "base", fullSignature: "full",
  items: ["top", "bottom"], action: "rejected", createdAt: "2026-07-01T00:00:00.000Z",
  feedbackReason: { codes: ["not_me"] }, perItemFeedback: [{ itemId: "top", disliked: true }],
};
const amendment = { ...vote, _id: "amendment", action: undefined, eventKind: "reason_amendment", reactionId: "vote",
  createdAt: "2026-07-02T00:00:00.000Z", feedbackReason: { codes: ["wrong_context"] },
  perItemFeedback: [{ itemId: "bottom", disliked: true }] };

it("replaces reasons while preserving vote identity and immutable inputs", () => {
  const before = JSON.stringify([vote, amendment]);
  const [effective] = resolveFeedbackEvidence([vote], [amendment]);
  expect(effective).toEqual({ ...vote, feedbackReason: amendment.feedbackReason, perItemFeedback: amendment.perItemFeedback });
  expect(JSON.stringify([vote, amendment])).toBe(before);
});

it("an explicit empty replacement clears prior reasons and per-item dislikes", () => {
  const empty = { ...amendment };
  Reflect.deleteProperty(empty, "feedbackReason");
  Reflect.deleteProperty(empty, "perItemFeedback");
  const [effective] = resolveFeedbackEvidence([vote], [empty]);
  expect(effective).not.toHaveProperty("feedbackReason");
  expect(effective).not.toHaveProperty("perItemFeedback");
});

it.each([
  { user: "other" }, { reactionId: "removed" }, { snapshotId: "other" },
  { candidateId: "other" }, { baseKey: "other" }, { fullSignature: "other" }, { items: ["top", "foreign"] },
])("ignores orphan, owner or binding mismatch %j", mismatch => {
  expect(resolveFeedbackEvidence([vote], [{ ...amendment, ...mismatch }])).toEqual([vote]);
});

it("uses latest amendment time and ID deterministically without increasing vote support", () => {
  const newer = { ...amendment, _id: "z", feedbackReason: { codes: ["not_practical"] } };
  expect(resolveFeedbackEvidence([vote], [newer, amendment])[0].feedbackReason).toEqual(newer.feedbackReason);
  expect(resolveFeedbackEvidence([vote], [amendment, newer])).toHaveLength(1);
});

it("leaves absent-eventKind legacy votes untouched, including historical reason-bearing rejection events", () => {
  const legacyEnrichment = { ...vote, _id: "legacy", createdAt: "2026-07-03T00:00:00Z" };
  expect(resolveFeedbackEvidence([vote, legacyEnrichment], [])).toEqual([vote, legacyEnrichment]);
});

it("does not attach legacy dislike amendments to an accepted vote", () => {
  const accepted = { ...vote, action: "accepted" };
  expect(resolveFeedbackEvidence([accepted], [amendment])).toEqual([accepted]);
});

it("an amendment carrying corrupt vote fields cannot win History or export", () => {
  const corrupt = { ...amendment, action: "accepted" };
  expect(pickHistory([vote, corrupt])).toEqual([vote]);
  expect([...pickExport([vote, corrupt]).values()]).toEqual([vote]);
  expect(resolveFeedbackEvidence([vote, corrupt], [corrupt])).toHaveLength(1);
});

it("scoped reservations and their removal preserve an accepted vote identity and weight", () => {
  const accepted = { ...vote, action: "accepted", perItemFeedback: undefined };
  const scoped = { ...amendment, perItemFeedback: undefined, feedbackReason: { scope: "item", concern: "fit", itemId: "top" } };
  expect(resolveFeedbackEvidence([accepted], [scoped])).toEqual([{ ...accepted, feedbackReason: scoped.feedbackReason }]);
  const cleared = { ...scoped, _id: "later", createdAt: "2026-07-03T00:00:00Z", feedbackReason: undefined };
  expect(resolveFeedbackEvidence([accepted], [scoped, cleared])).toEqual([{ ...accepted, feedbackReason: undefined }]);
});
