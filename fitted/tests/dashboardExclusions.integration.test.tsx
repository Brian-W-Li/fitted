/** Client integration only. Real Home/panels/hook logic; authored owner-scoped HTTP responses, no database/provider claim. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "firebase/auth";
import { deserialize, serialize } from "node:v8";
const mockUser = { uid: "exclusions-owner", getIdToken: async () => "owner-token" } as User;
jest.mock("@/lib/firebaseClient", () => ({ auth: { get currentUser() { return mockUser; } } }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: User) => void) => { callback(mockUser); return () => {}; }, signOut: jest.fn() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams("") }));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn() }));
import Dashboard from "@/app/(app)/dashboard/page";
import { emptyStyleMemory, findExclusionSet, type StyleContextSelection, type StyleMemoryData } from "@/lib/styleMemory/contract";
import { applyStyleCommand, publicStyleMemory } from "@/lib/styleMemory/state";
import { parseStyleMemoryCommand } from "@/lib/styleMemory/validation";

const id = (number: number) => number.toString(16).padStart(24, "0");
const selected: StyleContextSelection = { boardId: id(1), profileId: id(2), profileVersion: 1, routineId: id(3), routineVersion: 1, learningEnabled: false };
const wardrobe = [
  { id: id(101), name: "Authored shirt", clothingType: "top", isAvailable: true },
  { id: id(102), name: "Authored trousers", clothingType: "bottom", isAvailable: true },
  { id: id(103), name: "Authored coat", clothingType: "outer_layer", isAvailable: true },
  { id: id(104), name: "Authored shoes", clothingType: "shoes", isAvailable: true },
];
const pendingKey = `fitted_pending_render:${mockUser.uid}`;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const response = (body: unknown, status = 200) => { const frozen = copy(body); return { ok: status >= 200 && status < 300, status, json: async () => frozen } as Response; };
type Body = Record<string, unknown>;
let data: StyleMemoryData, revision: number, sequence: number, posts: Body[], stylePosts: Body[], styleReads: number;
let recommend: (body: Body, index: number) => Response | Promise<Response>;
function operationId() { return `${(++sequence).toString(16).padStart(8, "0")}-1111-4111-8111-000000000001`; }
function replaceSaved(itemIds: string[]) {
  const previous = findExclusionSet(data, selected);
  const command = parseStyleMemoryCommand({ kind: "set_exclusions", operationId: operationId(), expectedRevision: revision,
    boardId: selected.boardId, profileVersion: 1, routineId: selected.routineId, routineVersion: 1, expectedSetRevision: previous?.revision ?? 0,
    itemIds, outfitItemIds: [] });
  applyStyleCommand(data, command, ++revision, "2026-11-15T00:00:00Z");
  return findExclusionSet(data, selected)!;
}
function resultFor(body: Body, number: number) {
  const selection = body.styleContext as StyleContextSelection;
  const board = data.boards.find(board => board.id === selection.boardId)!;
  const routine = data.routines.find(routine => routine.id === selection.routineId)!;
  return { bindable: true, styleContext: { ...selection, boardLabel: board.label, routineLabel: routine.label,
    compiled: board.versions[0].compiled, memoryRevision: revision, weather: "unspecified" },
    shown: [{ snapshotId: id(1000 + number), candidateId: `candidate-${number}`, templateType: "two_piece", displayItems: wardrobe.slice(0, 2).map(item => ({ itemId: item.id, name: item.name, clothingType: item.clothingType })),
      styleMove: { moveType: "color", changedItemIds: [id(101)], oneSentence: `Authored client result ${number}` } }],
    flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null } };
}
async function ready() {
  await screen.findByRole("button", { name: "New direction" });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveValue(id(1)));
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled());
}
async function event() { await userEvent.type(screen.getByPlaceholderText(/Outdoor brunch with friends/i), "Authored client test class"); }
async function once() {
  await userEvent.click(screen.getByText("Leave pieces or an exact outfit out"));
  await userEvent.click(await screen.findByRole("radio", { name: "Authored coat" }));
  await userEvent.click(screen.getByRole("button", { name: "Leave out on next request" }));
  expect(within(screen.getByRole("list", { name: "Next-request exclusions" })).getByText("One piece: Authored coat")).toBeInTheDocument();
}
async function generate() { await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); }
beforeEach(() => {
  // jsdom lacks the browser structured-clone primitive used to capture modal context.
  Object.defineProperty(globalThis, "structuredClone", { configurable: true, value: (value: unknown) => deserialize(serialize(value)) });
  sessionStorage.clear(); localStorage.clear(); posts = []; stylePosts = []; styleReads = 0; revision = 1; sequence = 0;
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: operationId });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
  data = emptyStyleMemory();
  data.boards = [1, 2].map(number => ({ id: id(number === 1 ? 1 : 5), profileId: id(number === 1 ? 2 : 6), label: number === 1 ? "Campus" : "Evening",
    status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: "2026-11-15T00:00:00Z", rawSource: "relaxed", compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] } }], learningOptIns: [] }));
  data.routines = [{ id: id(3), label: "Class", status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: "2026-11-15T00:00:00Z", label: "Class" }] }];
  data.selectedBoardId = selected.boardId; data.selectedRoutineId = selected.routineId;
  recommend = (body, number) => response(resultFor(body, number));
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/wardrobe") return response({ items: wardrobe });
    if (path === "/api/style-memory") {
      if (init?.method !== "POST") { styleReads++; return response(publicStyleMemory(data, revision)); }
      const raw = JSON.parse(String(init.body)); stylePosts.push(copy(raw));
      const command = parseStyleMemoryCommand(raw);
      expect(command.expectedRevision).toBe(revision);
      applyStyleCommand(data, command, ++revision, "2026-11-15T00:00:00Z");
      return response({ state: publicStyleMemory(data, revision), operation: { id: command.operationId, revision } });
    }
    if (path === "/api/recommend") { const body = JSON.parse(String(init?.body)); posts.push(copy(body)); return recommend(body, posts.length); }
    if (path === "/api/interactions") return response({ interactions: [] });
    return response({}, 404);
  }) as typeof fetch;
});

it("binds a visible next-request choice once, consumes its draft before dispatch and omits it from a following root", async () => {
  let finish!: (value: Response) => void;
  recommend = () => new Promise(resolve => { finish = resolve; });
  render(<Dashboard />); await ready(); await event(); await once(); await generate();
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].requestExclusions).toEqual({ itemIds: [id(103)], outfitItemIds: [] });
  expect(posts[0].styleContext).toEqual(selected);
  expect(screen.queryByRole("list", { name: "Next-request exclusions" })).not.toBeInTheDocument();
  const pending = JSON.parse(sessionStorage.getItem(pendingKey)!);
  expect(pending.requestId).toBe(posts[0].requestId); expect(pending.requestExclusions).toEqual(posts[0].requestExclusions);
  await act(async () => { finish(response(resultFor(posts[0], 1))); });
  await screen.findByText("Authored client result 1");
  expect(sessionStorage.getItem(pendingKey)).toBeNull();
  recommend = (body, number) => response(resultFor(body, number));
  await generate(); await screen.findByText("Authored client result 2");
  expect(posts).toHaveLength(2); expect(posts[1].requestId).not.toBe(posts[0].requestId);
  expect(posts[1]).not.toHaveProperty("requestExclusions");
});

it("recovers a 5xx with the exact frozen ID/body after remount, without copying once rules into a later command", async () => {
  const originalSet = replaceSaved([id(104)]);
  let completed: ReturnType<typeof resultFor>;
  recommend = (body, number) => { completed = resultFor(body, number); return response({ error: { code: "internal" } }, 500); };
  const first = render(<Dashboard />); await ready(); await event(); await once(); await generate();
  await screen.findByText(/Something went wrong on our side/);
  const initial = copy(posts[0]); expect(initial.exclusionRef).toEqual({ id: originalSet.id, revision: originalSet.revision });
  expect(initial.requestExclusions).toEqual({ itemIds: [id(103)], outfitItemIds: [] });
  expect(sessionStorage.getItem(pendingKey)).not.toBeNull();
  const updated = replaceSaved([id(103)]); // Authored other-client update; the old completed request still replays its original capture.
  first.unmount(); recommend = () => response(completed!);
  render(<Dashboard />); await screen.findByText("Authored client result 1");
  await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1]).toEqual(initial);
  expect(sessionStorage.getItem(pendingKey)).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled());
  recommend = (body, number) => response(resultFor(body, number));
  await generate(); await screen.findByText("Authored client result 3");
  expect(posts).toHaveLength(3); expect(posts[2].requestId).not.toBe(initial.requestId);
  expect(posts[2]).not.toHaveProperty("requestExclusions"); expect(posts[2].exclusionRef).toEqual({ id: updated.id, revision: updated.revision });
});

it("dispatches acknowledged saved refs and refreshes a stale409 without any automatic recommendation", async () => {
  render(<Dashboard />); await ready(); await event();
  await userEvent.click(screen.getByText("Leave pieces or an exact outfit out"));
  await userEvent.click(await screen.findByRole("radio", { name: "Authored coat" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion scope" }), "saved");
  await userEvent.click(screen.getByRole("button", { name: "Save exclusion for this direction and situation" }));
  await screen.findByText("Saved changes.");
  const acknowledged = findExclusionSet(data, selected)!;
  expect(stylePosts).toHaveLength(1); expect(stylePosts[0]).toMatchObject({ kind: "set_exclusions", expectedSetRevision: 0, itemIds: [id(103)], outfitItemIds: [] });
  expect(within(screen.getByRole("list", { name: "Saved exclusions" })).getByText("One piece: Authored coat")).toBeInTheDocument();
  let updated: typeof acknowledged;
  recommend = () => { updated = replaceSaved([id(104)]); return response({ error: { code: "exclusions_changed" } }, 409); };
  await generate(); await screen.findByText(/Saved exclusions changed. Review the refreshed rules/);
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Saved exclusions" })).getByText("One piece: Authored shoes")).toBeInTheDocument());
  expect(posts).toHaveLength(1); expect(posts[0].exclusionRef).toEqual({ id: acknowledged.id, revision: acknowledged.revision });
  expect(styleReads).toBeGreaterThanOrEqual(2); expect(sessionStorage.getItem(pendingKey)).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled());
  await act(async () => { await Promise.resolve(); }); expect(posts).toHaveLength(1);
  recommend = (body, number) => response(resultFor(body, number));
  await generate(); await screen.findByText("Authored client result 2");
  expect(posts).toHaveLength(2); expect(posts[1].exclusionRef).toEqual({ id: updated!.id, revision: updated!.revision });
  expect(posts[1].requestId).not.toBe(posts[0].requestId);
});

it("previews a card's captured context rather than today's selection and refuses to open old-card Regenerate during a new root", async () => {
  replaceSaved([id(104)]);
  render(<Dashboard />); await ready(); await event(); await generate(); await screen.findByText("Authored client result 1");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Style direction" }), id(5));
  await screen.findByText("Saved changes.");
  await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  const modal = screen.getByRole("heading", { name: "Regenerate" }).parentElement!.parentElement!;
  expect(await within(modal).findByText("One piece: Authored shoes")).toBeInTheDocument();
  await userEvent.click(within(modal).getByRole("button", { name: "Cancel" }));
  // Select a Routine for the new root; context switching must not retarget the old result's card.
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Saved situation" }), id(3));
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled());
  let finish!: (value: Response) => void;
  recommend = () => new Promise(resolve => { finish = resolve; });
  await generate(); await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].styleContext).toMatchObject({ boardId: id(5), profileId: id(6) });
  await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(screen.queryByRole("heading", { name: "Regenerate" })).not.toBeInTheDocument();
  await act(async () => { finish(response(resultFor(posts[1], 2))); }); await screen.findByText("Authored client result 2");
  expect(screen.queryByRole("heading", { name: "Regenerate" })).not.toBeInTheDocument(); expect(posts).toHaveLength(2);
});

it("can remove an earlier semantic version's saved exclusion without changing today's scope", async () => {
  replaceSaved([id(104)]);
  render(<Dashboard />); await ready(); await event(); await generate(); await screen.findByText("Authored client result 1");
  await userEvent.click(screen.getByRole("button", { name: "Manage saved choices" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit meaning: Campus" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Style word or phrase" }), "structured");
  await userEvent.click(screen.getByRole("button", { name: "Add style phrase" }));
  await userEvent.click(screen.getByRole("button", { name: "Review direction" }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(data.boards[0].currentVersion).toBe(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  await screen.findByText("One piece: Authored shoes");
  await userEvent.click(screen.getByRole("button", { name: "Manage exclusions for this saved direction" }));
  expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeDisabled();
  await userEvent.click(screen.getByText("Leave pieces or an exact outfit out"));
  await userEvent.click(await screen.findByRole("button", { name: "Remove piece: Authored shoes" }));
  await waitFor(() => expect(stylePosts.filter(command => command.kind === "set_exclusions")).toHaveLength(1));
  expect(stylePosts.find(command => command.kind === "set_exclusions")).toMatchObject({ profileVersion: 1, routineVersion: 1, itemIds: [], outfitItemIds: [] });
  expect(findExclusionSet(data, selected)!.entries).toEqual([]);
  expect(findExclusionSet(data, { ...selected, profileVersion: 2 })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Done managing earlier exclusions" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Done managing earlier exclusions" }));
  expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled();
  expect(data.boards[0].currentVersion).toBe(2); expect(posts).toHaveLength(1);
});
