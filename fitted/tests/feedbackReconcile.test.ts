/**
 * Audit #2/#4 — the dashboard must reflect History curation, not a stale cached mark. Pins that
 * reconciling shown outfits against server latest-state: flips a stale "disliked"→"liked" (so the
 * lingering "Tell us why?" that would post a superseding rejected disappears), clears a removed
 * reaction (so the card is re-rateable), keeps a still-disliked mark, and no-ops when already in sync.
 */
import { reconcileShownFeedback, feedbackFromAction, buildActionByKey } from "@/lib/feedbackReconcile";

type Shown = { snapshotId: string; candidateId: string; feedback?: "liked" | "disliked" };
const card = (candidateId: string, feedback?: "liked" | "disliked"): Shown => ({
  snapshotId: "s1",
  candidateId,
  feedback,
});
const key = (candidateId: string) => `s1:${candidateId}`;

describe("feedbackFromAction", () => {
  it("maps server actions to chips; unknown/absent → unrated", () => {
    expect(feedbackFromAction("accepted")).toBe("liked");
    expect(feedbackFromAction("rejected")).toBe("disliked");
    expect(feedbackFromAction(undefined)).toBeUndefined();
    expect(feedbackFromAction("planned")).toBeUndefined();
  });
});

describe("buildActionByKey (history GET → reconcile map; TEST-1 drift guard)", () => {
  it("keys each latest-state row by {snapshotId}:{candidateId} → action (matching feedbackKey)", () => {
    const map = buildActionByKey([
      { snapshotId: "s1", candidateId: "c1", action: "accepted" },
      { snapshotId: "s1", candidateId: "c2", action: "rejected" },
    ]);
    // The map key MUST match the card key reconcileShownFeedback derives, or reconciliation silently
    // no-ops and the stale-chip corpus vector reopens.
    expect(map.get(key("c1"))).toBe("accepted");
    expect(map.get(key("c2"))).toBe("rejected");
    // And it actually drives a reconcile end-to-end (flips a stale mark).
    const { shown } = reconcileShownFeedback([card("c1", "disliked")], map);
    expect(shown[0].feedback).toBe("liked");
  });

  it("skips rows missing any of snapshotId / candidateId / action (degenerate/unbound)", () => {
    const map = buildActionByKey([
      { snapshotId: "s1", candidateId: "c1" }, // no action
      { snapshotId: "s1", action: "accepted" }, // no candidateId
      { candidateId: "c3", action: "accepted" }, // no snapshotId
    ]);
    expect(map.size).toBe(0);
  });

  it("tolerates null/undefined input", () => {
    expect(buildActionByKey(undefined).size).toBe(0);
    expect(buildActionByKey(null).size).toBe(0);
  });
});

describe("reconcileShownFeedback (audit #2/#4)", () => {
  it("flips a stale 'disliked' to 'liked' when the server shows the card was flipped (kills the stale enrich)", () => {
    const shown = [card("c1", "disliked")];
    const { shown: out, changed } = reconcileShownFeedback(shown, new Map([[key("c1"), "accepted"]]));
    expect(changed).toBe(true);
    expect(out[0].feedback).toBe("liked");
  });

  it("clears a stale mark when the reaction was REMOVED in History (card becomes re-rateable)", () => {
    const shown = [card("c1", "disliked")];
    const { shown: out, changed } = reconcileShownFeedback(shown, new Map()); // no server row
    expect(changed).toBe(true);
    expect(out[0].feedback).toBeUndefined();
  });

  it("keeps a mark that still matches the server (a genuinely-current dislike)", () => {
    const shown = [card("c1", "disliked")];
    const { shown: out, changed } = reconcileShownFeedback(shown, new Map([[key("c1"), "rejected"]]));
    expect(changed).toBe(false);
    expect(out).toBe(shown); // same ref — no needless re-render
    expect(out[0].feedback).toBe("disliked");
  });

  it("reconciles a mixed set and only rewrites what diverged", () => {
    const shown = [card("c1", "disliked"), card("c2", "liked"), card("c3")];
    const server = new Map([
      [key("c1"), "accepted"], // flipped → liked
      [key("c2"), "accepted"], // unchanged → liked
      // c3 absent → stays unrated
    ]);
    const { shown: out, changed } = reconcileShownFeedback(shown, server);
    expect(changed).toBe(true);
    expect(out.map((o) => o.feedback)).toEqual(["liked", "liked", undefined]);
    expect(out[1]).toBe(shown[1]); // c2 unchanged → same object ref
  });
});
