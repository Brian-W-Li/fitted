import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { randomUUID } from "crypto";
import type { User } from "firebase/auth";
import type { StyleMemoryState } from "@/lib/styleMemory/contract";
import type { CapturedStyleContext } from "@/lib/styleContext";
const mockUser = { uid: "superseded-owner", getIdToken: async () => "owner-token" } as User;
jest.mock("@/lib/firebaseClient", () => ({ auth: { get currentUser() { return mockUser; } } }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: User) => void) => { callback(mockUser); return () => {}; }, signOut: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams("") }));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn() }));
import Dashboard from "@/app/(app)/dashboard/page";
import StyleDirectionPanel from "@/app/(app)/dashboard/StyleDirectionPanel";

const boardId = "a".repeat(24), profileId = "b".repeat(24), routineId = "c".repeat(24);
const context: CapturedStyleContext = { boardId, profileId, profileVersion: 1, routineId, routineVersion: 1,
  learningEnabled: true, boardLabel: "Captured campus", routineLabel: "Captured class", memoryRevision: 5,
  compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] }, weather: "unspecified" };
const version = { version: 1, createdAt: "2026-01-01T00:00:00Z", rawSource: "relaxed", compiled: context.compiled };
const initialMemory: StyleMemoryState = { revision: 5, selectedBoardId: boardId, selectedRoutineId: routineId,
  boards: [{ id: boardId, profileId, label: context.boardLabel, status: "active", currentVersion: 1, versions: [version], learningOptIns: [{ profileVersion: 1, routineId, routineVersion: 1, enabled: true }] }],
  routines: [{ id: routineId, label: context.routineLabel!, status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: version.createdAt, label: context.routineLabel! }] }] };
const refreshedMemory: StyleMemoryState = { ...initialMemory, revision: 7,
  boards: [{ ...initialMemory.boards[0], label: "Revised direction", currentVersion: 2, versions: [version, { ...version, version: 2, rawSource: "expressive", compiled: { ...context.compiled, aestheticKeywords: ["expressive"] } }] }],
  routines: [{ ...initialMemory.routines[0], label: "Revised situation", currentVersion: 2, versions: [...initialMemory.routines[0].versions, { version: 2, createdAt: version.createdAt, label: "Revised situation" }] }] };
const flags = { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null };
const oldOutfit = { snapshotId: "d".repeat(24), candidateId: "c0", displayItems: [{ itemId: "e".repeat(24), name: "Previously shown green shirt", clothingType: "top" }], styleMove: null };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
async function openSavedDirection() {
  const panel = within(await screen.findByRole("region", { name: "Saved style direction" }));
  await userEvent.click(panel.getByRole("button", { name: "Change direction" }));
  await panel.findByRole("button", { name: "New direction" });
}
function displayedResult() {
  const result = screen.getByText("Previously shown green shirt").closest(".mt-6.space-y-4");
  if (!result) throw new Error("Expected the retained outfit and its captured context together");
  return within(result as HTMLElement);
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
});

function installScenario(failRefresh = false) {
  sessionStorage.setItem("fitted_dashboard_v2:superseded-owner", JSON.stringify({ occasion: "class", lensSummary: { occasion: "class", styleContext: context }, result: { styleContext: context, shown: [oldOutfit], flags, bindable: true } }));
  let memory = initialMemory;
  let reads = 0;
  const commands: Record<string, unknown>[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/wardrobe") return response({ items: [{ id: "existing" }] });
    if (path === "/api/style-memory") {
      reads++;
      if (failRefresh && reads === 2) return response({ error: "Refresh is temporarily unavailable" }, 503);
      return response(memory);
    }
    if (path === "/api/interactions") return response({ interactions: [] });
    if (path.startsWith("/api/experiences/suggestion?")) return response({ suggestion: { ...oldOutfit, styleContext: context } });
    if (path === "/api/recommend") {
      commands.push(JSON.parse(String(init?.body)));
      if (commands.length === 1) {
        memory = refreshedMemory; // Another tab edits both meanings while the stylist works.
        return response({ commandStatus: "superseded", shown: [], flags, bindable: false });
      }
      return response({ shown: [{ ...oldOutfit, snapshotId: "f".repeat(24), displayItems: [{ ...oldOutfit.displayItems[0], name: "Fresh expressive shirt" }] }], flags, bindable: true });
    }
    return response({}, 404);
  }) as typeof fetch;
  return { commands, reads: () => reads };
}

it("refreshes superseded saved meaning before an explicit new request while preserving the old captured outfit", async () => {
  const { commands } = installScenario();
  render(<Dashboard />);
  await screen.findByText("Previously shown green shirt");
  const generate = screen.getByRole("button", { name: /get recommendations/i });
  await waitFor(() => expect(generate).toBeEnabled());
  await userEvent.click(generate);
  await screen.findByText(/styling memory changed while these outfits were being prepared/i);
  await openSavedDirection();
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveDisplayValue("Revised direction"));
  expect(screen.getByRole("combobox", { name: "Saved situation" })).toHaveDisplayValue("Revised situation");
  expect(screen.getByRole("checkbox", { name: /Use experimental taste learning/ })).not.toBeChecked();
  expect(screen.getByText("Previously shown green shirt")).toBeInTheDocument();
  expect(displayedResult().getByText("Captured campus · Captured class")).toBeInTheDocument();
  expect(commands).toHaveLength(1); // Refresh is read-only, never an automatic render retry.
  expect(sessionStorage.getItem("fitted_pending_render:superseded-owner")).toBeNull();
  expect(commands[0].styleContext).toMatchObject({ profileVersion: 1, routineVersion: 1, learningEnabled: true });
  await waitFor(() => expect(screen.getByRole("button", { name: /get recommendations/i })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await screen.findByText("Fresh expressive shirt");
  expect(screen.getByRole("link", { name: "View 1 shown outfit" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Previous outfits" })).not.toBeInTheDocument();
  expect(commands).toHaveLength(2);
  expect(commands[1].requestId).not.toBe(commands[0].requestId);
  expect(commands[1].styleContext).toEqual({ boardId, profileId, profileVersion: 2, routineId, routineVersion: 2, learningEnabled: false });
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url) === "/api/style-memory")).toHaveLength(2);
});


it("blocks stale generation after a failed superseded refresh until an explicit read retry succeeds", async () => {
  const scenario = installScenario(true);
  render(<Dashboard />);
  await screen.findByText("Previously shown green shirt");
  await waitFor(() => expect(screen.getByRole("button", { name: /get recommendations/i })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  const retry = await screen.findByRole("button", { name: "Retry saved directions" });
  expect(screen.getByText("Refresh is temporarily unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /get recommendations/i })).toBeDisabled();
  await openSavedDirection();
  expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveDisplayValue("Captured campus");
  expect(screen.getByText("Previously shown green shirt")).toBeInTheDocument();
  expect(displayedResult().getByText("Captured campus · Captured class")).toBeInTheDocument();
  expect(sessionStorage.getItem("fitted_pending_render:superseded-owner")).toBeNull();
  await act(async () => { await Promise.resolve(); });
  expect(scenario.commands).toHaveLength(1);
  expect(scenario.reads()).toBe(2); // Failure does not start a read/recommend retry loop.
  await userEvent.click(retry);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveDisplayValue("Revised direction"));
  await waitFor(() => expect(screen.getByRole("button", { name: /get recommendations/i })).toBeEnabled());
  expect(scenario.reads()).toBe(3);
  expect(scenario.commands).toHaveLength(1);
  expect(displayedResult().getByText("Captured campus · Captured class")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await screen.findByText("Fresh expressive shirt");
  expect(scenario.commands[1].styleContext).toMatchObject({ profileVersion: 2, routineVersion: 2, learningEnabled: false });
  expect(scenario.commands[1].requestId).not.toBe(scenario.commands[0].requestId);
});

it("defers an explicit memory refresh while a write is uncertain and retains its exact retry command", async () => {
  const commands: string[] = [];
  let reads = 0;
  const stateAfterWrite = { ...refreshedMemory, selectedBoardId: null, selectedRoutineId: null };
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      commands.push(String(init.body));
      if (commands.length === 1) throw new Error("Acknowledgement lost");
      return response({ state: stateAfterWrite, operation: { id: JSON.parse(commands[0]).operationId, revision: 6 } });
    }
    reads++; return response(reads === 1 ? initialMemory : stateAfterWrite);
  }) as typeof fetch;
  const onChange = jest.fn(), onPendingChange = jest.fn();
  const panel = render(<StyleDirectionPanel user={mockUser} onChange={onChange} onPendingChange={onPendingChange} refreshGeneration={0} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toBeEnabled());
  expect(reads).toBe(1);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Style direction" }), "");
  await screen.findByRole("button", { name: "Retry same change" });
  panel.rerender(<StyleDirectionPanel user={mockUser} onChange={onChange} onPendingChange={onPendingChange} refreshGeneration={1} />);
  await act(async () => { await Promise.resolve(); });
  expect(reads).toBe(1);
  expect(onPendingChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole("button", { name: "Retry same change" }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  expect(screen.queryByRole("button", { name: "Retry same change" })).not.toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null);
  panel.rerender(<StyleDirectionPanel user={mockUser} onChange={onChange} onPendingChange={onPendingChange} refreshGeneration={1} />);
  await act(async () => { await Promise.resolve(); });
  expect(reads).toBe(2); // An already-consumed generation is not another refresh.
});


it("keeps captured outfits reachable while a different request draft is pending and fails", async () => {
  installScenario();
  const readApi = global.fetch;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === "/api/recommend" ? pending : readApi(url, init)) as typeof fetch;
  render(<Dashboard />);
  await screen.findByText("Previously shown green shirt");
  const jump = screen.getByRole("link", { name: "View 1 shown outfit" });
  expect(jump).toHaveAttribute("href", "#home-outfits");
  expect(screen.getByRole("heading", { name: "Shown outfits" })).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("link", { name: "Back to request" })).toHaveAttribute("href", "#home-request");
  expect(screen.getByRole("heading", { name: "Get Outfit Recommendations" })).toHaveAttribute("tabindex", "-1");
  const input = screen.getByRole("textbox", { name: "Event description" });
  await userEvent.clear(input); await userEvent.type(input, "Dinner draft");
  expect(displayedResult().getByText("Requested for: class")).toBeInTheDocument();
  expect(displayedResult().queryByText(/Dinner draft/)).not.toBeInTheDocument();
  const generate = screen.getByRole("button", { name: /get recommendations/i });
  await waitFor(() => expect(generate).toBeEnabled());
  await userEvent.click(generate);
  expect(await screen.findByRole("link", { name: "View 1 previous outfit" })).toHaveAttribute("href", "#home-outfits");
  expect(screen.getByRole("heading", { name: "Previous outfits" })).toBeInTheDocument();
  expect(displayedResult().getByText("Captured campus · Captured class")).toBeInTheDocument();
  await act(async () => { finish(response({}, 503)); await pending; });
  await screen.findByText(/went wrong on our side/i);
  expect(screen.getByRole("link", { name: "View 1 previous outfit" })).toBeInTheDocument();
  expect(displayedResult().getByText("Requested for: class")).toBeInTheDocument();
  expect(input).toHaveValue("Dinner draft");
  expect(JSON.parse(sessionStorage.getItem("fitted_pending_render:superseded-owner")!).lensSummary.occasion).toBe("Dinner draft");
});


it("does not label current outfits previous after failed feedback or invalid request text", async () => {
  installScenario();
  const readApi = global.fetch;
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === "/api/interactions" && init?.method === "POST" ? Promise.resolve(response({}, 503)) : readApi(url, init)) as typeof fetch;
  render(<Dashboard />);
  await screen.findByText("Previously shown green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Like" }));
  await screen.findByText(/couldn.t confirm your feedback/i);
  expect(screen.getByRole("link", { name: "View 1 shown outfit" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Previous outfits" })).not.toBeInTheDocument();
  await userEvent.clear(screen.getByRole("textbox", { name: "Event description" }));
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
  await screen.findByText("Describe the event or context to get recommendations.");
  expect(screen.getByRole("link", { name: "View 1 shown outfit" })).toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url) === "/api/recommend")).toHaveLength(0);
});
