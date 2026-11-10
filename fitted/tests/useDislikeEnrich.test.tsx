import { renderHook, act, waitFor } from "@testing-library/react";
import { useDislikeEnrich, type EnrichTarget } from "@/lib/useDislikeEnrich";
const target: EnrichTarget = { snapshotId: "68a0000000000000000000a1", candidateId: "c1", reactionId: "68a0000000000000000000b1" };
const data = { perItemFeedback: [{ itemId: "t1", disliked: true }], codes: ["not_me"] };
beforeEach(() => { let sequence = 0; Object.defineProperty(crypto, "randomUUID", { configurable: true,
  value: jest.fn(() => `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`) }); });

it("targets a reason amendment at the opened reaction without emitting another vote", async () => {
  const post = jest.fn().mockResolvedValue("saved");
  const { result } = renderHook(() => useDislikeEnrich(post));
  await act(async () => { await result.current.saveDislikeReasons(target, data); });
  expect(post.mock.calls[0]).toEqual([{ kind: "reason_amendment", reactionId: target.reactionId,
    operationId: expect.any(String), feedbackReason: { codes: data.codes }, perItemFeedback: data.perItemFeedback }]);
  expect(result.current.statusFor(target)).toBeUndefined();
});
it("holds the exact command, reaction and operation through uncertain retries", async () => {
  const post = jest.fn().mockRejectedValueOnce(new Error("ack lost")).mockResolvedValueOnce("saved");
  const { result } = renderHook(() => useDislikeEnrich(post));
  await act(async () => { await result.current.saveDislikeReasons(target, data); });
  expect(result.current.statusFor(target)).toBe("failed");
  const original = JSON.stringify(post.mock.calls[0][0]);
  await act(async () => { result.current.retryEnrich(target); });
  await waitFor(() => expect(result.current.statusFor(target)).toBeUndefined());
  expect(JSON.stringify(post.mock.calls[1][0])).toBe(original);
});
it("discards terminal stale commands instead of retrying them forever", async () => {
  const post = jest.fn().mockResolvedValue("stale");
  const { result } = renderHook(() => useDislikeEnrich(post));
  await act(async () => { expect(await result.current.saveDislikeReasons(target, data)).toBe(false); });
  expect(result.current.statusFor(target)).toBeUndefined();
  await act(async () => { result.current.retryEnrich(target); });
  expect(post).toHaveBeenCalledTimes(1);
});
it("prevents concurrent retry dispatch and does not retarget a held command", async () => {
  let finish!: (outcome: "saved") => void;
  const post = jest.fn().mockResolvedValueOnce("retry").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useDislikeEnrich(post));
  await act(async () => { await result.current.saveDislikeReasons(target, data); });
  await act(async () => {
    result.current.retryEnrich({ ...target, reactionId: "another-reaction" });
    result.current.retryEnrich(target); result.current.retryEnrich(target);
  });
  expect(post).toHaveBeenCalledTimes(2);
  await act(async () => { finish("saved"); });
});
it("an older completion cannot remove a new reaction's held command", async () => {
  let finish!: (outcome: "saved") => void;
  const newer = { ...target, reactionId: "68a0000000000000000000b2" };
  const post = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce("retry");
  const { result } = renderHook(() => useDislikeEnrich(post));
  await act(async () => { void result.current.saveDislikeReasons(target, data); });
  await act(async () => { await result.current.saveDislikeReasons(newer, data); });
  await act(async () => { finish("saved"); });
  expect(result.current.statusFor(newer)).toBe("failed");
  expect(result.current.statusFor(target)).toBeUndefined();
});
it("owner changes discard held commands and ignore old asynchronous completions", async () => {
  let finish!: (outcome: "retry") => void;
  const post = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ owner }) => useDislikeEnrich(post as never, owner), { initialProps: { owner: "one" } });
  await act(async () => { void result.current.saveDislikeReasons(target, data); });
  rerender({ owner: "two" });
  await act(async () => { finish("retry"); result.current.retryEnrich(target); });
  expect(result.current.statusFor(target)).toBeUndefined();
  expect(post).toHaveBeenCalledTimes(1);
});
