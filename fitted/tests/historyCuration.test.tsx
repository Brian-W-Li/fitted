/**
 * D-1 — the History CURATION client (flip / remove). These paths mutate the training corpus (a
 * remove hard-deletes labels; a flip appends the opposite), so they get behavioral coverage, not just
 * the backend. Drives the real HistoryPage over a mocked fetch + auth, asserting: latest-state cards
 * split into the right tabs; a flip POSTs the opposite action for the right binding and moves the card;
 * a remove DELETEs the binding (after confirm) and drops the card.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    if (method === "POST") return { ok: true, status: 200, json: async () => ({ success: true,
      interaction: { id: "650000000000000000000099", action: JSON.parse(String(opts.body)).action } }) } as Response;
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


it("identifies captured scopes for the same outfit and changes only the chosen reaction", async () => {
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "11111111-1111-4111-8111-111111111111" });
  const firstId = "650000000000000000000011", secondId = "650000000000000000000012";
  const cards = [
    { ...seedCards()[0], id: firstId, learningAvailable: true, learningDisposition: "normal", dispositionRevision: 0,
      capturedContext: { boardLabel: "Campus", profileVersion: 1, routineLabel: "Class", routineVersion: 1 } },
    { ...seedCards()[0], id: secondId, snapshotId: "68a0000000000000000000a2", learningAvailable: true, learningDisposition: "normal", dispositionRevision: 0,
      capturedContext: { boardLabel: "Evening", profileVersion: 2, routineLabel: "Dinner", routineVersion: 3 } },
  ];
  global.fetch = jest.fn(async (url, opts) => {
    const method = opts?.method ?? "GET";
    calls.push({ url: String(url), method, body: opts?.body as string | undefined });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ interactions: cards }) } as Response;
    const command = JSON.parse(String(opts?.body));
    const card = cards.find(row => row.id === command.reactionId)!;
    card.learningDisposition = command.learningDisposition; card.dispositionRevision++;
    return { ok: true, status: 200, json: async () => ({ success: true, amendment: { id: "650000000000000000000013",
      reactionId: card.id, learningDisposition: card.learningDisposition, dispositionRevision: card.dispositionRevision } }) } as Response;
  });
  render(<HistoryPage />);
  const campus = await screen.findByRole("group", { name: "Captured context: Campus / Class" });
  const evening = screen.getByRole("group", { name: "Captured context: Evening / Dinner" });
  expect(screen.getAllByText("White Tee").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("brunch")).toHaveLength(2);
  await userEvent.click(within(evening).getByText("Captured versions"));
  expect(within(evening).getByText("Direction version 2 · Situation version 3")).toBeVisible();
  await userEvent.click(within(evening).getByRole("button", { name: "Exclude from taste learning" }));
  await screen.findByRole("button", { name: "Also reflects my taste here" });
  const commands = calls.filter(call => call.method === "POST").map(call => JSON.parse(call.body!));
  expect(commands).toEqual([{ kind: "learning_disposition", reactionId: secondId,
    operationId: "11111111-1111-4111-8111-111111111111", expectedDispositionRevision: 0, learningDisposition: "exception" }]);
  expect(cards[0].learningDisposition).toBe("normal");
  expect(within(screen.getByRole("group", { name: "Captured context: Campus / Class" })).getByRole("button", { name: "Exclude from taste learning" })).toBeEnabled();
  expect(campus).toHaveTextContent("Direction: Campus");
});

it("shows a board-only captured direction without inventing a saved situation or learning control", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ interactions: [{ ...seedCards()[0],
    capturedContext: { boardLabel: "Open direction", profileVersion: 1, routineLabel: null, routineVersion: null } }] }) }) as Response);
  render(<HistoryPage />);
  const context = await screen.findByRole("group", { name: "Captured context: Open direction / No saved situation" });
  expect(context).toHaveTextContent("No saved situation");
  expect(within(context).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Situation version")).not.toBeInTheDocument();
});


it.each(["accepted", "rejected"])("can add a delayed scoped concern to a plain %s reaction without replacing the vote", async action => {
  const reactionId = "650000000000000000000041";
  const card = { ...seedCards()[0], id: reactionId, action, learningAvailable: true,
    learningDisposition: "normal", dispositionRevision: 0, feedbackReason: undefined as Record<string, unknown> | undefined };
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "11111111-1111-4111-8111-111111111141" });
  global.fetch = jest.fn(async (url, opts) => {
    const method = opts?.method ?? "GET";
    calls.push({ url: String(url), method, body: opts?.body as string | undefined });
    if (method === "GET") return { ok: true, status: 200, json: async () => ({ interactions: [card] }) } as Response;
    const command = JSON.parse(String(opts?.body));
    card.feedbackReason = command.feedbackReason; card.learningDisposition = "exception"; card.dispositionRevision = 1;
    return { ok: true, status: 200, json: async () => ({ success: true, amendment: { id: "650000000000000000000042", reactionId } }) } as Response;
  });
  render(<HistoryPage />);
  if (action === "rejected") await userEvent.click(await screen.findByRole("button", { name: /Disliked/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Something’s off" }));
  await userEvent.click(screen.getByRole("button", { name: "Fit" }));
  await userEvent.selectOptions(screen.getByLabelText("Which item?"), "t1");
  await userEvent.type(screen.getByLabelText("A quick note (optional)"), "Sleeves felt too long today");
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(await screen.findByText("Sleeves felt too long today")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Also reflects my taste here" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: action === "accepted" ? "Change to dislike" : "Change to like" })).toBeInTheDocument();
  const commands = calls.filter(call => call.method === "POST").map(call => JSON.parse(call.body!));
  expect(commands).toEqual([{ kind: "reason_amendment", reactionId, operationId: "11111111-1111-4111-8111-111111111141",
    feedbackReason: { codes: [], scope: "item", itemId: "t1", concern: "fit", rawText: "Sleeves felt too long today" }, perItemFeedback: [] }]);
});

it("offers no delayed concern editor for an unbound legacy reaction", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ interactions: [{ ...seedCards()[0], snapshotId: null, candidateId: null }] }) }) as Response);
  render(<HistoryPage />);
  await screen.findByText("White Tee");
  expect(screen.queryByRole("button", { name: "Something’s off" })).not.toBeInTheDocument();
});


it("disables the delayed concern editor while a learning correction is unconfirmed", async () => {
  const reactionId = "650000000000000000000051";
  let finish!: (response: Response) => void;
  global.fetch = jest.fn(async (_url, opts) => {
    if (opts?.method === "POST") return await new Promise<Response>(resolve => { finish = resolve; });
    return { ok: true, status: 200, json: async () => ({ interactions: [{ ...seedCards()[0], id: reactionId,
      learningAvailable: true, learningDisposition: "normal", dispositionRevision: 0 }] }) } as Response;
  });
  render(<HistoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Exclude from taste learning" }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole("button", { name: "Something’s off" })).toBeDisabled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => finish({ ok: false, status: 503, json: async () => ({}) } as Response));
  expect(screen.getByRole("button", { name: "Something’s off" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry learning change" })).toBeInTheDocument();
});

it.each([false, true])("keeps the same learning retry available after Refresh reports committed=%s", async committed => {
  const reactionId = "650000000000000000000061";
  const amendmentId = "650000000000000000000062";
  const original = { ...seedCards()[0], id: reactionId, learningAvailable: true };
  const commands: string[] = [];
  let saved = false, reads = 0;
  const currentCard = () => ({ ...original, learningDisposition: saved ? "exception" : "normal", dispositionRevision: saved ? 1 : 0 });
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "11111111-1111-4111-8111-111111111161" });
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method !== "POST") {
      reads++;
      // Each read owns its snapshot; later writes cannot mutate a prior response.
      const snapshot = JSON.parse(JSON.stringify(currentCard()));
      return { ok: true, status: 200, json: async () => ({ interactions: [snapshot] }) } as Response;
    }
    commands.push(String(options.body));
    if (commands.length === 1) {
      saved = committed;
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }
    saved = true;
    return { ok: true, status: 200, json: async () => ({ success: true, amendment: {
      id: amendmentId, reactionId, dispositionRevision: 1, learningDisposition: "exception",
    } }) } as Response;
  }) as typeof fetch;

  render(<HistoryPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Exclude from taste learning" }));
  await screen.findByRole("button", { name: "Retry learning change" });
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(reads).toBe(2));
  const effectiveControl = committed ? "Also reflects my taste here" : "Exclude from taste learning";
  await waitFor(() => expect(screen.getByRole("button", { name: effectiveControl })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Something’s off" })).toBeDisabled();
  expect(commands).toHaveLength(1);
  const retry = screen.getByRole("button", { name: "Retry learning change" });
  expect(retry).toBeEnabled();

  await userEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry learning change" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "Also reflects my taste here" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Something’s off" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Change to dislike" })).toBeEnabled();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  expect(JSON.parse(commands[1])).toEqual({ kind: "learning_disposition", reactionId,
    operationId: "11111111-1111-4111-8111-111111111161", expectedDispositionRevision: 0, learningDisposition: "exception" });
  expect(reads).toBe(3);
});

it.each([false, true].flatMap(committed => ["missing-id", "unreadable", "wrong-action"].map(receipt => ({ committed, receipt }))))(
  "reconciles a malformed flip receipt ($receipt, committed=$committed) before a follow-up correction", async ({ committed, receipt }) => {
    const oldReactionId = "650000000000000000000071", newReactionId = "650000000000000000000072";
    const original = { ...seedCards()[0], id: oldReactionId, learningAvailable: true };
    const commands: Record<string, unknown>[] = [];
    let flipped = false, excluded = false, reads = 0;
    const currentId = () => flipped ? newReactionId : oldReactionId;
    global.fetch = jest.fn(async (_url, options) => {
      if (options?.method !== "POST") {
        reads++;
        const snapshot = JSON.parse(JSON.stringify({ ...original, id: currentId(), action: flipped ? "rejected" : "accepted",
          learningDisposition: excluded ? "exception" : "normal", dispositionRevision: excluded ? 1 : 0 }));
        return { ok: true, status: 200, json: async () => ({ interactions: [snapshot] }) } as Response;
      }
      const command = JSON.parse(String(options.body)); commands.push(command);
      if (command.kind === "learning_disposition") {
        excluded = true;
        return { ok: true, status: 200, json: async () => ({ success: true, amendment: {
          id: "650000000000000000000073", reactionId: currentId(), dispositionRevision: 1, learningDisposition: "exception",
        } }) } as Response;
      }
      flipped = committed;
      return { ok: true, status: 200, json: async () => {
        if (receipt === "unreadable") throw new SyntaxError("Incomplete acknowledgement");
        return { success: true, interaction: receipt === "missing-id" ? { action: "rejected" } : { id: newReactionId, action: "accepted" } };
      } } as Response;
    }) as typeof fetch;

    render(<HistoryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Change to dislike" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(commands).toEqual([{ snapshotId: original.snapshotId, candidateId: original.candidateId, action: "rejected" }]);
    if (committed) await userEvent.click(screen.getByRole("button", { name: /^Disliked/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: committed ? "Change to like" : "Change to dislike" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Exclude from taste learning" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Also reflects my taste here" })).toBeEnabled());
    expect(commands).toHaveLength(2); // The second write is deliberate correction, never an automatic flip retry.
    expect(commands[1]).toMatchObject({ kind: "learning_disposition", reactionId: committed ? newReactionId : oldReactionId,
      expectedDispositionRevision: 0, learningDisposition: "exception" });
    expect(reads).toBe(3);
  },
);
