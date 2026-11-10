import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
jest.mock("@/lib/firebaseClient", () => ({ auth: { currentUser: { uid: "reason-owner", getIdToken: async () => "token" } } }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
  callback({ uid: "reason-owner", getIdToken: async () => "token" }); return () => {};
}, signOut: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams("") }));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn() }));
import Dashboard from "@/app/(app)/dashboard/page";
const snapshotId = "650000000000000000000001";
const reactionId = "650000000000000000000002";
const currentId = "650000000000000000000003";
const amendmentId = "650000000000000000000004";
const renderResult = { shown: [{ snapshotId, candidateId: "c1", displayItems: [{ itemId: "650000000000000000000005", name: "Green shirt", clothingType: "top" }], styleMove: null }],
  flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null }, bindable: true };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
let posts: Record<string, unknown>[];
function api(onPost: (body: Record<string, unknown>) => Response | Promise<Response>, history: () => Response | Promise<Response> = () => response({ interactions: [] })) {
  posts = [];
  global.fetch = jest.fn(async (path, init) => {
    if (String(path) === "/api/interactions") {
      if (init?.method === "POST") { const body = JSON.parse(String(init.body)); posts.push(body); return await onPost(body); }
      return await history();
    }
    if (String(path).startsWith("/api/wardrobe")) return response({ items: [{ id: "one" }, { id: "two" }] });
    if (String(path) === "/api/recommend") return response(renderResult);
    return response({}, 404);
  });
}
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); Object.defineProperty(crypto, "randomUUID", { configurable: true,
  value: jest.fn(() => "11111111-1111-4111-8111-111111111111") }); });
async function generateAndDislike() {
  render(<Dashboard />);
  await userEvent.type(await screen.findByPlaceholderText(/outdoor brunch with friends/i), "Class");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Dislike" }));
  await userEvent.click(await screen.findByRole("button", { name: "Something’s off" }));
  await userEvent.click(screen.getByRole("button", { name: "Style" }));
}
it("adds reasons to the primary receipt and retries the same command without another vote", async () => {
  let attempts = 0;
  api(body => body.kind === "reason_amendment" ? (++attempts === 1 ? response({}, 503) : response({ success: true, amendment: { id: amendmentId, reactionId } }))
    : response({ interaction: { id: reactionId, action: "rejected" } }));
  await generateAndDislike();
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  await userEvent.click(await screen.findByRole("button", { name: /Couldn't save the details/ }));
  await waitFor(() => expect(screen.queryByText("Saving details…")).not.toBeInTheDocument());
  expect(posts[0]).toEqual({ snapshotId, candidateId: "c1", action: "rejected" });
  expect(posts[1]).toEqual({ kind: "reason_amendment", reactionId, operationId: expect.any(String), feedbackReason: { scope: "request", concern: "style", codes: [] }, perItemFeedback: [] });
  expect(posts[2]).toEqual(posts[1]);
});
it("a reaction changed while the modal was open cannot be reversed by its old reasons", async () => {
  api(body => body.kind === "reason_amendment" ? response({ error: { code: "reaction_changed" } }, 409)
    : response({ interaction: { id: reactionId, action: "rejected" } }),
    () => response({ interactions: [{ snapshotId, candidateId: "c1", action: "accepted", id: currentId }] }));
  await generateAndDislike();
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByText(/That reaction changed or was removed/)).toBeInTheDocument();
  expect(await screen.findByText("Liked")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Couldn't save the details/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Something’s off" })).toBeInTheDocument();
  expect(posts[1].reactionId).toBe(reactionId);
  expect(posts[1]).not.toHaveProperty("action");
  expect(posts).toHaveLength(2);
});
it("restored cached chips require fresh History to obtain an amendment target", async () => {
  let finish!: (value: Response) => void;
  sessionStorage.setItem("fitted_dashboard_v2:reason-owner", JSON.stringify({ occasion: "Class", result: { ...renderResult,
    shown: [{ ...renderResult.shown[0], feedback: "disliked", reactionId }] } }));
  api(body => response({ success: true, amendment: { id: amendmentId, reactionId: body.reactionId } }),
    () => new Promise(resolve => { finish = resolve; }));
  render(<Dashboard />);
  await screen.findByText("Disliked");
  expect(screen.queryByRole("button", { name: "Something’s off" })).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish(response({ interactions: [{ snapshotId, candidateId: "c1", action: "rejected", id: currentId }] })); });
  await userEvent.click(await screen.findByRole("button", { name: "Something’s off" }));
  await userEvent.click(screen.getByRole("button", { name: "Style" }));
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].reactionId).toBe(currentId);
});
it("an unvalidated primary success cannot authorize optional reasons", async () => {
  api(() => response({ interaction: { id: reactionId, action: "accepted" } }));
  render(<Dashboard />);
  await userEvent.type(await screen.findByPlaceholderText(/outdoor brunch with friends/i), "Class");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Dislike" }));
  expect(await screen.findByText(/Couldn't confirm your feedback/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Something’s off" })).not.toBeInTheDocument();
  expect(posts).toHaveLength(1);
});


it("a mismatched amendment acknowledgement remains held for the same safe retry", async () => {
  api(body => body.kind === "reason_amendment" ? response({ success: true, amendment: { id: amendmentId, reactionId: currentId } })
    : response({ interaction: { id: reactionId, action: "rejected" } }));
  await generateAndDislike();
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByRole("button", { name: /Couldn't save the details/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Couldn't save the details/ }));
  await waitFor(() => expect(posts).toHaveLength(3));
  expect(posts[2]).toEqual(posts[1]);
});


it.each([200, 503])("an older dislike acknowledgement (%s) cannot replace or clear a newer like receipt", async oldStatus => {
  let finishOld!: (value: Response) => void;
  api(body => body.action === "rejected" ? new Promise(resolve => { finishOld = resolve; })
    : response({ interaction: { id: currentId, action: "accepted" } }));
  render(<Dashboard />);
  await userEvent.type(await screen.findByPlaceholderText(/outdoor brunch with friends/i), "Class");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  const dislike = await screen.findByRole("button", { name: "Dislike" });
  const like = screen.getByRole("button", { name: "Like" });
  // Competing input events delivered before the optimistic render commits must
  // receive the same protections as separate asynchronous responses.
  act(() => { fireEvent.click(dislike); fireEvent.click(like); });
  await waitFor(() => expect(posts).toHaveLength(2));
  await screen.findByText("Liked");
  await act(async () => { finishOld(response({ interaction: { id: reactionId, action: "rejected" } }, oldStatus)); });
  expect(screen.getByText("Liked")).toBeInTheDocument();
  expect(screen.queryByText(/Couldn.t confirm your feedback/)).not.toBeInTheDocument();
  const saved = JSON.parse(sessionStorage.getItem("fitted_dashboard_v2:reason-owner")!);
  expect(saved.result.shown[0]).toMatchObject({ feedback: "liked", reactionId: currentId });
});


it("keeps a like while saving an item-specific fit concern without inventing a disliked item", async () => {
  api(body => body.kind === "reason_amendment" ? response({ success: true, amendment: { id: amendmentId, reactionId } })
    : response({ interaction: { id: reactionId, action: "accepted" } }));
  render(<Dashboard />);
  await userEvent.type(await screen.findByPlaceholderText(/outdoor brunch with friends/i), "Class");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Like" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Something’s off" }));
  await userEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Which item?"), "650000000000000000000005");
  await userEvent.type(screen.getByLabelText("A quick note (optional)"), "Too big for me");
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByText("Too big for me")).toBeInTheDocument();
  expect(screen.getByText("Liked")).toBeInTheDocument();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toMatchObject({ kind: "reason_amendment", reactionId,
    feedbackReason: { scope: "item", itemId: "650000000000000000000005", concern: "fit", rawText: "Too big for me", codes: [] }, perItemFeedback: [] });
  expect(posts[1]).not.toHaveProperty("action");
  await userEvent.click(screen.getByRole("button", { name: "Edit details" }));
  expect(screen.getByLabelText("A quick note (optional)")).toHaveValue("Too big for me");
  await userEvent.click(screen.getByRole("button", { name: "Clear details" }));
  await waitFor(() => expect(screen.queryByText("Too big for me")).not.toBeInTheDocument());
  expect(screen.getByText("Liked")).toBeInTheDocument();
  expect(posts[2]).toMatchObject({ feedbackReason: { codes: [] }, perItemFeedback: [] });
  expect(posts.filter(post => post.action)).toHaveLength(1);
});

it("fresh History restores scoped details for editing and cancellation leaves them intact", async () => {
  const reason = { scope: "request", concern: "formality", rawText: "Too formal for class" };
  sessionStorage.setItem("fitted_dashboard_v2:reason-owner", JSON.stringify({ occasion: "Class", result: { ...renderResult,
    shown: [{ ...renderResult.shown[0], feedback: "liked", reactionId, feedbackReason: { ...reason, rawText: "Stale text" } }] } }));
  api(() => response({}), () => response({ interactions: [{ snapshotId, candidateId: "c1", action: "accepted", id: reactionId, feedbackReason: reason }] }));
  render(<Dashboard />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  expect(screen.getByRole("button", { name: "Not for today" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("A quick note (optional)")).toHaveValue("Too formal for class");
  await userEvent.clear(screen.getByLabelText("A quick note (optional)"));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Too formal for class")).toBeInTheDocument();
  expect(posts).toHaveLength(0);
});
