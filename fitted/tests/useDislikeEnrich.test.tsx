/**
 * D-3 — the dislike-reason enrich must NEVER silently lose the "why" (the sole trainable reason
 * channel, §16). This drives the real hook state machine (`lib/useDislikeEnrich`) with an injected
 * postEnrich, proving: success clears; FAILURE is held (not dropped) and retryable with the SAME
 * payload; a still-failing retry stays retryable; candidates are independent.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDislikeEnrich, enrichKey, type EnrichBinding } from "@/lib/useDislikeEnrich";

const binding: EnrichBinding = { snapshotId: "68a0000000000000000000a1", candidateId: "c1" };
const data = { perItemFeedback: [{ itemId: "t1", disliked: true }], codes: ["not_me"] };

describe("useDislikeEnrich (D-3)", () => {
  it("clears the pending state on a successful enrich", async () => {
    const post = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useDislikeEnrich(post));

    await act(async () => {
      await result.current.saveDislikeReasons(binding, data);
    });

    expect(post).toHaveBeenCalledWith(binding, data);
    expect(result.current.statusFor(binding)).toBeUndefined(); // settled, nothing lingering
  });

  it("HOLDS a failed enrich (reason not lost) and a retry resends the SAME payload to success", async () => {
    const post = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useDislikeEnrich(post));

    await act(async () => {
      await result.current.saveDislikeReasons(binding, data);
    });
    // The transport failed — but the reason is HELD, surfacing the retry affordance (never dropped).
    expect(result.current.statusFor(binding)).toBe("failed");

    await act(async () => {
      result.current.retryEnrich(binding);
    });
    await waitFor(() => expect(result.current.statusFor(binding)).toBeUndefined());

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith(binding, data); // the retry resent the exact reasons
  });

  it("a retry that still fails stays 'failed' (retryable again — never silently gives up)", async () => {
    const post = jest.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useDislikeEnrich(post));

    await act(async () => {
      await result.current.saveDislikeReasons(binding, data);
    });
    await act(async () => {
      result.current.retryEnrich(binding);
    });
    await waitFor(() => expect(result.current.statusFor(binding)).toBe("failed"));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retryEnrich is a no-op when nothing is pending for that binding", async () => {
    const post = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useDislikeEnrich(post));
    await act(async () => {
      result.current.retryEnrich(binding);
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("tracks candidates independently (one fails, one succeeds)", async () => {
    const other: EnrichBinding = { snapshotId: binding.snapshotId, candidateId: "c2" };
    const post = jest.fn((b: EnrichBinding) => Promise.resolve(b.candidateId === "c1"));
    const { result } = renderHook(() => useDislikeEnrich(post));

    await act(async () => {
      await result.current.saveDislikeReasons(binding, data);
      await result.current.saveDislikeReasons(other, data);
    });

    expect(result.current.statusFor(binding)).toBeUndefined(); // c1 persisted
    expect(result.current.statusFor(other)).toBe("failed"); // c2 held for retry
    expect(enrichKey(other)).toBe(`${other.snapshotId}:c2`);
  });
});
