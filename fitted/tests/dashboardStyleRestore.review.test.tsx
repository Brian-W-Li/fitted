import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "crypto";
import type { User } from "firebase/auth";
const mockUser = { uid: "restore-owner", getIdToken: async () => "owner-token" } as User;
jest.mock("@/lib/firebaseClient", () => ({ auth: { get currentUser() { return mockUser; } } }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: User) => void) => { callback(mockUser); return () => {}; }, signOut: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams("") }));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn() }));
import Dashboard from "@/app/(app)/dashboard/page";

const dashboardKey = "fitted_dashboard_v2:restore-owner";
const context = { boardId: "a".repeat(24), profileId: "b".repeat(24), profileVersion: 1, routineId: null, routineVersion: null,
  learningEnabled: false, boardLabel: "Erased campus direction", routineLabel: null, compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] }, memoryRevision: 1, weather: "unspecified" };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
async function openSavedDirection() {
  const panel = within(await screen.findByRole("region", { name: "Saved style direction" }));
  await userEvent.click(panel.getByRole("button", { name: "Change direction" }));
  await panel.findByRole("button", { name: "New direction" });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
});

function saveCache() {
  sessionStorage.setItem(dashboardKey, JSON.stringify({ occasion: "class", lensSummary: { occasion: "class", styleContext: context }, result: {
    styleContext: context,
    shown: [{ snapshotId: "d".repeat(24), candidateId: "c0", displayItems: [{ itemId: "e".repeat(24), name: "Erased-source green shirt", clothingType: "top" }], styleMove: null }],
    flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null }, bindable: true,
  } }));
  return sessionStorage.getItem(dashboardKey)!;
}

function mockApi(suggestion: () => Response | Promise<Response>, options: {
  boards?: unknown[]; recommend?: () => Response | Promise<Response>;
} = {}) {
  global.fetch = jest.fn(async (url: unknown) => {
    const path = String(url);
    if (path === "/api/wardrobe") return response({ items: [{ id: "existing" }] });
    if (path === "/api/style-memory") return response({ revision: 2, boards: options.boards ?? [], routines: [], selectedBoardId: null, selectedRoutineId: null });
    if (path === "/api/interactions") return response({ interactions: [] });
    if (path.startsWith("/api/experiences/suggestion?")) return suggestion();
    if (path === "/api/recommend" && options.recommend) return options.recommend();
    return response({}, 404);
  }) as typeof fetch;
}

const visibleSuggestion = () => response({ suggestion: { snapshotId: "d".repeat(24), candidateId: "c0", styleContext: context } });
const retainedBoard = () => ({ id: context.boardId, profileId: context.profileId,
  label: "Current campus direction", status: "active", currentVersion: 1, learningOptIns: [], versions: [
    { version: 1, createdAt: "2026-01-01T00:00:00Z", rawSource: "relaxed", compiled: context.compiled },
  ] });

it("does not restore an outfit or copied direction content after the server reports its source erased", async () => {
  saveCache();
  mockApi(() => response({ error: "Suggestion unavailable" }, 404));

  render(<Dashboard />);
  await openSavedDirection();
  await waitFor(() => expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument());
  expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
  expect(sessionStorage.getItem(dashboardKey)).toBeNull();
  expect(screen.queryByRole("link", { name: /^View \d+ (shown|previous) outfits?$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to request" })).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) => String(url) === "/api/recommend" || init?.method === "POST")).toBe(false);
});

it.each(["active", "archived"])("restores a verified %s source with its captured label and version", async status => {
  const original = saveCache();
  mockApi(visibleSuggestion, { boards: [{ id: context.boardId, profileId: context.profileId,
    label: "Renamed direction", status, currentVersion: 2, learningOptIns: [], versions: [
      { version: 1, createdAt: "2026-01-01T00:00:00Z", rawSource: "relaxed", compiled: context.compiled },
      { version: 2, createdAt: "2026-01-02T00:00:00Z", rawSource: "formal", compiled: { aestheticKeywords: ["formal"], palette: [], patterns: [], fits: [] } },
    ] }] });
  render(<Dashboard />);
  expect(await screen.findByText("Erased-source green shirt")).toBeInTheDocument();
  expect(screen.getByText("Erased campus direction")).toBeInTheDocument();
  expect(sessionStorage.getItem(dashboardKey)).toBe(original);
  expect(screen.getByRole("link", { name: "View 1 shown outfit" })).toBeInTheDocument();
  expect(screen.getByText("Requested for: class")).toBeInTheDocument();
  const [url, init] = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).startsWith("/api/experiences/suggestion?"))!;
  expect(String(url)).toContain(`snapshotId=${"d".repeat(24)}`);
  expect(init).toMatchObject({ headers: { Authorization: "Bearer owner-token" }, cache: "no-store" });
  expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) => String(url) === "/api/recommend" || init?.method === "POST")).toBe(false);
});

it("keeps temporarily unverified source content hidden while retaining its cache for retry", async () => {
  const original = saveCache();
  mockApi(() => response({}, 503), { boards: [retainedBoard()] });
  render(<Dashboard />);
  expect(await screen.findByText(/couldn.t verify your saved outfits/i)).toBeInTheDocument();
  expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
  expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
  expect(sessionStorage.getItem(dashboardKey)).toBe(original);
  expect((global.fetch as jest.Mock).mock.calls.some(([url, init]) => String(url) === "/api/recommend" || init?.method === "POST")).toBe(false);
});

it.each([200, 404])("does not let delayed restore verification (%s) replace a newer generated result or its cache", async status => {
  saveCache();
  let finishRestore!: (value: Response) => void;
  const delayed = new Promise<Response>(resolve => { finishRestore = resolve; });
  mockApi(() => delayed, { boards: [retainedBoard()], recommend: () => response({
    shown: [{ snapshotId: "f".repeat(24), candidateId: "new", displayItems: [
      { itemId: "e".repeat(24), name: "Fresh blue shirt", clothingType: "top" },
    ], styleMove: null }],
    flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null }, bindable: true,
  }) });
  render(<Dashboard />);
  await openSavedDirection();
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).startsWith("/api/experiences/suggestion?"))).toBe(true));
  expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText(/outdoor brunch with friends/i), "coffee with friends");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await screen.findByText("Fresh blue shirt");
  const freshCache = sessionStorage.getItem(dashboardKey);
  await act(async () => { finishRestore(status === 200 ? visibleSuggestion() : response({}, status)); await delayed; });
  expect(screen.getByText("Fresh blue shirt")).toBeInTheDocument();
  expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
  expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
  expect(sessionStorage.getItem(dashboardKey)).toBe(freshCache);
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url) === "/api/recommend")).toHaveLength(1);
});

it.each(["erase cached direction", "archive cached direction", "erase unrelated direction"])("handles %s while cached restore verification is still pending", async action => {
  const original = saveCache();
  let finishRestore!: (body: unknown) => void;
  const delayedBody = new Promise<unknown>(resolve => { finishRestore = resolve; });
  let validationStarted = false;
  const cached = retainedBoard();
  const unrelated = { ...retainedBoard(), id: "1".repeat(24), profileId: "2".repeat(24), label: "Other direction" };
  mockApi(() => {
    validationStarted = true;
    return { ok: true, status: 200, json: () => delayedBody } as Response;
  }, { boards: [cached, unrelated] });
  const readApi = global.fetch;
  const archived = action === "archive cached direction";
  const targeted = action === "erase unrelated direction" ? unrelated : cached;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/style-memory" && init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      expect(command).toMatchObject({ kind: archived ? "archive_board" : "erase_board", boardId: targeted.id, expectedRevision: 2 });
      const boards = archived ? [{ ...cached, status: "archived" }, unrelated] : [cached, unrelated].filter(board => board.id !== targeted.id);
      return response({ state: { revision: 3, boards, routines: [], selectedBoardId: null, selectedRoutineId: null },
        operation: { id: command.operationId, revision: 3 } });
    }
    return readApi(url, init);
  }) as typeof fetch;
  render(<Dashboard />);
  await openSavedDirection();
  await screen.findByRole("button", { name: "Manage saved choices" });
  await waitFor(() => expect(validationStarted).toBe(true));
  expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Manage saved choices" }));
  await userEvent.click(screen.getByRole("button", { name: `${archived ? "Archive" : "Erase"}: ${targeted.label}` }));
  if (!archived) await userEvent.click(screen.getByRole("button", { name: "Erase permanently" }));
  await screen.findByText("Saved changes.");
  const erasedSource = action === "erase cached direction";
  // The erase acknowledgement must clear copied content before the old read finishes.
  expect(sessionStorage.getItem(dashboardKey)).toBe(erasedSource ? null : original);
  await act(async () => {
    finishRestore({ suggestion: { snapshotId: "d".repeat(24), candidateId: "c0", styleContext: context } });
    await delayedBody;
  });
  if (erasedSource) {
    expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
    expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(dashboardKey)).toBeNull();
  expect(screen.queryByRole("link", { name: /^View \d+ (shown|previous) outfits?$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to request" })).not.toBeInTheDocument();
  } else {
    expect(await screen.findByText("Erased-source green shirt")).toBeInTheDocument();
    expect(screen.getByText("Erased campus direction")).toBeInTheDocument();
    expect(sessionStorage.getItem(dashboardKey)).toBe(original);
  }
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url) === "/api/recommend")).toBe(false);
});

it("removes displayed outfits and copied context after their direction is erased through Home", async () => {
  saveCache();
  mockApi(visibleSuggestion, { boards: [{ id: context.boardId, profileId: context.profileId,
    label: "Current campus direction", status: "active", currentVersion: 1, learningOptIns: [], versions: [
      { version: 1, createdAt: "2026-01-01T00:00:00Z", rawSource: "relaxed", compiled: context.compiled },
    ] }] });
  const readApi = global.fetch;
  let erased = false;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/style-memory" && init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      expect(command).toMatchObject({ kind: "erase_board", boardId: context.boardId, expectedRevision: 2 });
      erased = true;
      return response({ state: { revision: 3, boards: [], routines: [], selectedBoardId: null, selectedRoutineId: null },
        operation: { id: command.operationId, revision: 3 } });
    }
    if (String(url).startsWith("/api/experiences/suggestion?") && erased) return response({ error: "Suggestion unavailable" }, 404);
    return readApi(url, init);
  }) as typeof fetch;

  render(<Dashboard />);
  await screen.findByText("Erased-source green shirt");
  await openSavedDirection();
  await userEvent.click(screen.getByRole("button", { name: "Manage saved choices" }));
  await userEvent.click(screen.getByRole("button", { name: "Erase: Current campus direction" }));
  await userEvent.click(screen.getByRole("button", { name: "Erase permanently" }));
  await screen.findByText("Saved changes.");
  expect(erased).toBe(true);
  await waitFor(() => expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument());
  expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
  expect(sessionStorage.getItem(dashboardKey)).toBeNull();
  expect(screen.queryByRole("link", { name: /^View \d+ (shown|previous) outfits?$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to request" })).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url) === "/api/recommend")).toBe(false);
});

it("clears a retained unverified cache when its direction is erased after a temporary restore failure", async () => {
  const original = saveCache();
  mockApi(() => response({}, 503), { boards: [retainedBoard()] });
  const readApi = global.fetch;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/api/style-memory" && init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      expect(command).toMatchObject({ kind: "erase_board", boardId: context.boardId, expectedRevision: 2 });
      return response({ state: { revision: 3, boards: [], routines: [], selectedBoardId: null, selectedRoutineId: null },
        operation: { id: command.operationId, revision: 3 } });
    }
    return readApi(url, init);
  }) as typeof fetch;
  render(<Dashboard />);
  await screen.findByText(/couldn.t verify your saved outfits/i);
  expect(sessionStorage.getItem(dashboardKey)).toBe(original);
  expect(screen.queryByText("Erased-source green shirt")).not.toBeInTheDocument();
  await openSavedDirection();
  await userEvent.click(screen.getByRole("button", { name: "Manage saved choices" }));
  await userEvent.click(screen.getByRole("button", { name: "Erase: Current campus direction" }));
  await userEvent.click(screen.getByRole("button", { name: "Erase permanently" }));
  await screen.findByText("Saved changes.");
  expect(sessionStorage.getItem(dashboardKey)).toBeNull();
  expect(screen.queryByRole("link", { name: /^View \d+ (shown|previous) outfits?$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to request" })).not.toBeInTheDocument();
  expect(screen.queryByText("Erased campus direction")).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url) === "/api/recommend")).toBe(false);
});

it.each(["event", "cleared event", "weather", "time", "custom time"])("does not overwrite a started request draft (%s) when delayed styled-source validation completes", async field => {
  saveCache();
  let finish!: (response: Response) => void;
  const validation = new Promise<Response>(resolve => { finish = resolve; });
  mockApi(() => validation, { boards: [retainedBoard()] });
  render(<Dashboard />);
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).startsWith("/api/experiences/suggestion?"))).toBe(true));
  const input = screen.getByRole("textbox", { name: "Event description" });
  if (field.includes("event")) {
    fireEvent.change(input, { target: { value: "New dinner draft" } });
    if (field === "cleared event") fireEvent.change(input, { target: { value: "" } });
  } else {
    fireEvent.click(screen.getByLabelText("Time and weather"));
    if (field === "weather") {
      fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
      fireEvent.change(screen.getByLabelText("Rain"), { target: { value: "dry" } });
    } else if (field === "time") fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    else {
      fireEvent.click(screen.getByRole("button", { name: "Pick date/time" }));
      fireEvent.change(screen.getByLabelText("Event date and time"), { target: { value: "2026-11-18T12:30" } });
    }
    fireEvent.click(screen.getByLabelText("Time and weather"));
  }
  const authoredSummary = screen.getByLabelText("Time and weather").textContent;
  await act(async () => { finish(visibleSuggestion()); await validation; });
  await screen.findByText("Erased-source green shirt");
  expect(input).toHaveValue(field === "event" ? "New dinner draft" : "");
  expect(screen.getByLabelText("Time and weather").textContent).toBe(authoredSummary);
  expect(screen.getByText("Requested for: class")).toBeInTheDocument();
  expect(screen.getByText("Erased campus direction")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View 1 shown outfit" })).toBeInTheDocument();
});


it.each([404, 503])("shows frozen pending time even when the previous styled source cannot be restored (%s)", async status => {
  saveCache();
  const iso = "2026-11-18T20:30:00.000Z";
  sessionStorage.setItem("fitted_pending_render:restore-owner", JSON.stringify({ requestId: "frozen-time-request", intent: "daily", parentSnapshotId: null,
    normalizedControls: { lockedItemIds: [], dislikedItemIds: [] }, lensSummary: { occasion: "Pending future event", eventTimeISO: iso } }));
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  mockApi(() => response({}, status), { boards: [retainedBoard()], recommend: () => pending });
  render(<Dashboard />);
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url) === "/api/recommend")).toBe(true));
  const [url, init] = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url) === "/api/recommend")!;
  expect(url).toBe("/api/recommend"); expect(JSON.parse(init.body)).toMatchObject({ requestId: "frozen-time-request", occasion: "Pending future event", eventTimeISO: iso });
  const date = new Date(iso), pad = (n: number) => String(n).padStart(2, "0");
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  expect(screen.getByLabelText("Time and weather")).toHaveAccessibleDescription(`${local} · Event description / mild fallback`);
  expect(screen.getByRole("textbox", { name: "Event description" })).toHaveValue("Pending future event");
  await act(async () => { finish(response({ shown: [], flags: {}, bindable: false })); await pending; });
});

it("preserves a new draft when delayed source verification resumes an older pending request", async () => {
  saveCache();
  const frozen = { requestId: "frozen-draft-request", intent: "daily", parentSnapshotId: null,
    normalizedControls: { lockedItemIds: [], dislikedItemIds: [] }, lensSummary: { occasion: "Frozen pending event", eventTimeISO: "2026-11-18T20:30:00.000Z" } };
  sessionStorage.setItem("fitted_pending_render:restore-owner", JSON.stringify(frozen));
  let verify!: (response: Response) => void, finish!: (response: Response) => void;
  const validation = new Promise<Response>(resolve => { verify = resolve; });
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  mockApi(() => validation, { boards: [retainedBoard()], recommend: () => pending });
  render(<Dashboard />);
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).startsWith("/api/experiences/suggestion?"))).toBe(true));
  const input = screen.getByRole("textbox", { name: "Event description" });
  fireEvent.change(input, { target: { value: "My new draft" } });
  fireEvent.click(screen.getByLabelText("Time and weather"));
  fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
  fireEvent.click(screen.getByLabelText("Time and weather"));
  await act(async () => { verify(visibleSuggestion()); await validation; });
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url) === "/api/recommend")).toBe(true));
  expect(input).toHaveValue("My new draft");
  expect(screen.getByLabelText("Time and weather")).toHaveAccessibleDescription("Tomorrow · Event description / mild fallback");
  expect(screen.getByText("Requested for: class")).toBeInTheDocument();
  const calls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url) === "/api/recommend");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ requestId: frozen.requestId, occasion: frozen.lensSummary.occasion, eventTimeISO: frozen.lensSummary.eventTimeISO });
  await act(async () => { finish(response({ shown: [], flags: {}, bindable: false })); await pending; });
  expect(input).toHaveValue("My new draft");
});
