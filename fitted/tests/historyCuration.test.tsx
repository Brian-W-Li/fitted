/**
 * D-1 — the History CURATION client (flip / remove). These paths mutate the training corpus (a
 * remove hard-deletes labels; a flip appends the opposite), so they get behavioral coverage, not just
 * the backend. Drives the real HistoryPage over a mocked fetch + auth, asserting: latest-state cards
 * split into the right tabs; a flip POSTs the opposite action for the right binding and moves the card;
 * a remove DELETEs the binding (after confirm) and drops the card.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  // Fire the callback synchronously with a fake signed-in user, then a no-op unsubscribe.
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", getIdToken: async () => "tok" });
    return () => {};
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const HistoryPage = require("@/app/(app)/history/page").default as React.ComponentType;

interface Call {
  url: string;
  method: string;
  body?: string;
}
let calls: Call[];

function seedCards() {
  return [
    { id: "i1", action: "accepted", occasion: "brunch", createdAt: new Date().toISOString(), snapshotId: "68a0000000000000000000a1", candidateId: "c1", displayItems: [{ itemId: "t1", name: "White Tee" }], styleMove: null },
    { id: "i2", action: "rejected", occasion: "work", createdAt: new Date().toISOString(), snapshotId: "68a0000000000000000000a2", candidateId: "c2", displayItems: [{ itemId: "t2", name: "Gray Shirt" }], styleMove: null },
  ];
}

beforeEach(() => {
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = jest.fn(async (url: any, opts: any) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method, body: opts?.body });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ interactions: seedCards() }) } as Response;
    if (method === "POST") return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    if (method === "DELETE") return { ok: true, status: 200, json: async () => ({ success: true, deleted: 2 }) } as Response;
    return { ok: false, status: 500, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

describe("History curation (D-1)", () => {
  it("splits latest-state cards into the right tabs (one GET, not per-tab)", async () => {
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("White Tee")).toBeInTheDocument());
    // Liked tab (default) shows the accepted card, not the rejected one.
    expect(screen.queryByText("Gray Shirt")).not.toBeInTheDocument();
    // Exactly one interactions GET drove both tabs (no per-action double fetch).
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /Disliked/i }));
    expect(screen.getByText("Gray Shirt")).toBeInTheDocument();
  });

  it("flip POSTs the opposite action for the card's binding and moves it to the other tab", async () => {
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("White Tee")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Change to dislike/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(post!.body ?? "{}");
      expect(body).toMatchObject({ snapshotId: "68a0000000000000000000a1", candidateId: "c1", action: "rejected" });
    });
    // It moved to Disliked and left the Liked tab empty of that card.
    expect(screen.queryByText("White Tee")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Disliked/i }));
    expect(screen.getByText("White Tee")).toBeInTheDocument();
  });

  it("remove asks to confirm, then DELETEs the binding and drops the card", async () => {
    render(<HistoryPage />);
    await waitFor(() => expect(screen.getByText("White Tee")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
    expect(screen.getByText(/Remove this reaction\?/i)).toBeInTheDocument();
    // Confirm — the destructive button inside the confirm row.
    await userEvent.click(screen.getByRole("button", { name: /^Remove$/i }));

    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del).toBeDefined();
      expect(del!.url).toContain("snapshotId=68a0000000000000000000a1");
      expect(del!.url).toContain("candidateId=c1");
    });
    expect(screen.queryByText("White Tee")).not.toBeInTheDocument();
  });
});


it("edits and clears a saved concern from History while preserving its liked reaction", async () => {
  const reactionId = "650000000000000000000002";
  let note: Record<string, unknown> | undefined = { scope: "item", itemId: "t1", concern: "fit", rawText: "Too big" };
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "11111111-1111-4111-8111-111111111111" });
  global.fetch = jest.fn(async (url, opts) => {
    const method = opts?.method ?? "GET";
    calls.push({ url: String(url), method, body: opts?.body as string | undefined });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ interactions: [{ ...seedCards()[0], id: reactionId, feedbackReason: note }] }) } as Response;
    const command = JSON.parse(String(opts?.body));
    note = command.feedbackReason.scope ? command.feedbackReason : undefined;
    return { ok: true, status: 200, json: async () => ({ success: true, amendment: { id: "650000000000000000000003", reactionId } }) } as Response;
  });
  render(<HistoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  expect(screen.getByLabelText("A quick note (optional)")).toHaveValue("Too big");
  await userEvent.clear(screen.getByLabelText("A quick note (optional)"));
  await userEvent.type(screen.getByLabelText("A quick note (optional)"), "Sleeves too long");
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByText("Sleeves too long")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  await userEvent.click(screen.getByRole("button", { name: "Clear details" }));
  await waitFor(() => expect(screen.queryByText("Sleeves too long")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Change to dislike" })).toBeInTheDocument();
  const commands = calls.filter(call => call.method === "POST").map(call => JSON.parse(call.body!));
  expect(commands).toHaveLength(2);
  expect(commands.every(command => command.kind === "reason_amendment" && !command.action)).toBe(true);
  expect(commands[1]).toMatchObject({ reactionId, feedbackReason: { codes: [] }, perItemFeedback: [] });
});


it("a refresh started during removal cannot resurrect the removed reaction or its note", async () => {
  let finishDelete!: (value: Response) => void;
  let finishRefresh!: (value: Response) => void;
  const rows = [{ ...seedCards()[0], feedbackReason: { scope: "request", concern: "formality", rawText: "Old saved note" } }];
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
  let reads = 0;
  global.fetch = jest.fn(async (_url, opts) => {
    if (opts?.method === "DELETE") return await new Promise<Response>(resolve => { finishDelete = resolve; });
    if (++reads === 1) return ok({ interactions: rows });
    return await new Promise<Response>(resolve => { finishRefresh = resolve; });
  });
  render(<HistoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(finishDelete).toBeDefined());
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(finishRefresh).toBeDefined());
  await act(async () => { finishDelete(ok({ success: true, deleted: 2 })); });
  await act(async () => { finishRefresh(ok({ interactions: rows })); });
  expect(screen.queryByText("Old saved note")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change to dislike" })).not.toBeInTheDocument();
  expect(screen.queryByText("Loading history…")).not.toBeInTheDocument();
});
