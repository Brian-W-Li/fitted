/** Preview read/lifetime contracts; mocked GET fixtures do not establish server admission or provider behavior. */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useExclusionPreview, { type ExclusionPreview } from "@/lib/useExclusionPreview";
import ApplicableExclusions from "@/app/(app)/dashboard/ApplicableExclusions";
import type { ExclusionScopeSelection, StyleMemoryState } from "@/lib/styleMemory/contract";
const id = (number: number) => number.toString(16).padStart(24, "0");
const context: ExclusionScopeSelection = { boardId: id(1), profileId: id(2), profileVersion: 1, routineId: id(3), routineVersion: 1 };
const user = { uid: "owner-a", getIdToken: jest.fn(async () => "token-a") };
const compiled = { aestheticKeywords: ["authored"], palette: [], patterns: [], fits: [] };
function memory(): StyleMemoryState {
  return { revision: 7, selectedBoardId: id(1), selectedRoutineId: id(3), boards: [{ id: id(1), profileId: id(2), label: "Authored direction", status: "active", currentVersion: 2,
    versions: [1, 2].map(version => ({ version, createdAt: "2026-11-15T00:00:00Z", rawSource: `meaning ${version}`, compiled })), learningOptIns: [],
    exclusionSets: [{ id: id(10), revision: 5, profileVersion: 1, routineId: id(3), routineVersion: 1, entries: [
      { id: id(20), revision: 5, kind: "item", itemIds: [id(11)] },
      { id: id(21), revision: 5, kind: "combination", itemIds: [id(12), id(99)] }] },
    { id: id(110), revision: 6, profileVersion: 2, routineId: id(3), routineVersion: 2, entries: [{ id: id(120), revision: 6, kind: "item", itemIds: [id(13)] }] }] }],
    routines: [{ id: id(3), label: "Current situation", status: "active", currentVersion: 2, versions: [
      { version: 1, createdAt: "2026-11-15T00:00:00Z", label: "Original situation" }, { version: 2, createdAt: "2026-11-15T00:00:00Z", label: "Current situation" }] }] };
}
const wardrobe = [{ id: id(11), name: "Authored shirt" }, { id: id(12), name: "Authored trousers", isAvailable: false }, { id: id(13), name: "Later version piece" }];
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;
let fetchMock: jest.Mock;
beforeEach(() => { fetchMock = jest.fn(async (url: string) => response(url === "/api/style-memory" ? memory() : { items: wardrobe })); global.fetch = fetchMock; user.getIdToken.mockClear(); });

it.each(["disabled", "null-context", "undefined-context", "no-user"])("does not read for %s", async kind => {
  const { result } = renderHook(() => useExclusionPreview(kind === "no-user" ? null : user, kind === "null-context" ? null : kind === "undefined-context" ? undefined : context, kind !== "disabled"));
  expect(result.current).toMatchObject({ pending: false, error: "", ref: null, entries: [] });
  await act(async () => { result.current.retry(); }); expect(fetchMock).not.toHaveBeenCalled();
});

it("resolves retained profile/Routine versions rather than today's selected versions and names every complete member", async () => {
  const { result } = renderHook(() => useExclusionPreview(user, context, true));
  expect(result.current).toMatchObject({ pending: true, ref: null, entries: [] });
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.error).toBe(""); expect(result.current.ref).toEqual({ id: id(10), revision: 5 });
  expect(result.current.entries).toEqual([{ kind: "item", names: ["Authored shirt"] }, { kind: "combination", names: ["Authored trousers", "Unavailable piece"] }]);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/style-memory", "/api/wardrobe"]);
  expect(fetchMock.mock.calls.every(call => call[1].headers.Authorization === "Bearer token-a" && call[1].signal instanceof AbortSignal)).toBe(true);
  render(<ApplicableExclusions preview={result.current} scopeLabel="Original direction version 1 · Original situation version 1" />);
  expect(screen.getByText("Exact outfit: Authored trousers + Unavailable piece")).toBeInTheDocument();
  expect(screen.getByText(/Original direction version 1/)).toBeInTheDocument(); expect(screen.queryByText("Later version piece")).not.toBeInTheDocument();
});

it.each(["wrong-profile", "missing-board-version", "archived-board", "missing-routine-version", "archived-routine", "partial-null-routine"])("blocks the unavailable exact source %s without reading names", async kind => {
  const state = memory(), scope = { ...context };
  if (kind === "wrong-profile") scope.profileId = id(90);
  if (kind === "missing-board-version") scope.profileVersion = 3;
  if (kind === "archived-board") state.boards[0].status = "archived";
  if (kind === "missing-routine-version") scope.routineVersion = 3;
  if (kind === "archived-routine") state.routines[0].status = "archived";
  if (kind === "partial-null-routine") scope.routineId = null;
  fetchMock.mockResolvedValue(response(state));
  const { result } = renderHook(() => useExclusionPreview(user, scope, true));
  await waitFor(() => expect(result.current.error).toMatch(/no longer available/));
  expect(result.current).toMatchObject({ pending: false, ref: null, entries: [] }); expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["absent", "empty"])("does not fetch wardrobe names for an %s exact set", async kind => {
  const state = memory();
  if (kind === "absent") state.boards[0].exclusionSets = [];
  else state.boards[0].exclusionSets![0].entries = [];
  fetchMock.mockResolvedValue(response(state));
  const { result } = renderHook(() => useExclusionPreview(user, context, true));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.error).toBe(""); expect(result.current.entries).toEqual([]);
  expect(result.current.ref).toEqual(kind === "empty" ? { id: id(10), revision: 5 } : null);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("withholds the reference through a delayed name body and blocks failed reads until explicit retry", async () => {
  let resolveNames!: (body: unknown) => void;
  fetchMock.mockResolvedValueOnce(response(memory())).mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { resolveNames = resolve; }) } as Response);
  const { result } = renderHook(() => useExclusionPreview(user, context, true));
  await waitFor(() => expect(resolveNames).toBeDefined());
  expect(result.current).toMatchObject({ pending: true, error: "", ref: null, entries: [] });
  await act(async () => { resolveNames({ items: [{ id: id(11), name: "   " }] }); });
  expect(result.current.error).toMatch(/incomplete response/); expect(result.current.ref).toBeNull(); expect(result.current.entries).toEqual([]);
  await act(async () => { await Promise.resolve(); }); expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockResolvedValueOnce(response(memory())).mockResolvedValueOnce(response({ items: wardrobe }, false));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toMatch(/Couldn't load the pieces/));
  expect(result.current.ref).toBeNull();
  act(() => result.current.retry());
  expect(result.current).toMatchObject({ pending: true, error: "", ref: null, entries: [] });
  await waitFor(() => expect(result.current.ref).toEqual({ id: id(10), revision: 5 }));
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it.each(["owner", "context"])("fences a delayed old name body on %s changes", async mode => {
  let resolveOld!: (body: unknown) => void;
  fetchMock.mockResolvedValueOnce(response(memory())).mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { resolveOld = resolve; }) } as Response);
  const { result, rerender } = renderHook(({ person, scope }) => useExclusionPreview(person, scope, true), { initialProps: { person: user, scope: context } });
  await waitFor(() => expect(resolveOld).toBeDefined());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  const nextState = memory(); if (mode === "owner") nextState.boards[0].exclusionSets![0].id = id(88);
  fetchMock.mockResolvedValueOnce(response(nextState)).mockResolvedValueOnce(response({ items: wardrobe.map(item => ({ ...item, name: `New ${item.name}` })) }));
  const next = mode === "owner" ? { person: { uid: "owner-b", getIdToken: jest.fn(async () => "token-b") }, scope: context }
    : { person: user, scope: { ...context, profileVersion: 2, routineVersion: 2 } };
  rerender(next);
  expect(result.current).toMatchObject({ pending: true, ref: null, entries: [] });
  await waitFor(() => expect(result.current.ref?.id).toBe(mode === "owner" ? id(88) : id(110)));
  await act(async () => { resolveOld({ items: wardrobe }); });
  expect(signal.aborted).toBe(true);
  expect(result.current.entries.flatMap(entry => entry.names).every(name => name.startsWith("New ") || name === "Unavailable piece")).toBe(true);
  expect(result.current.ref?.id).toBe(mode === "owner" ? id(88) : id(110));
  if (mode === "owner") expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer token-b");
});

it("never reuses a ready ref on reopen and rereads only GETs after explicit refresh generation", async () => {
  const renders: Array<{ pending: boolean; ref: unknown; entries: unknown[] }> = [];
  const { result, rerender } = renderHook(({ enabled, refresh }) => {
    const preview = useExclusionPreview(user, context, enabled, refresh); renders.push({ pending: preview.pending, ref: preview.ref, entries: preview.entries }); return preview;
  }, { initialProps: { enabled: true, refresh: 0 } });
  await waitFor(() => expect(result.current.ref).not.toBeNull());
  rerender({ enabled: false, refresh: 0 }); expect(result.current).toMatchObject({ pending: false, ref: null, entries: [] });
  let resolveNew!: (body: unknown) => void;
  fetchMock.mockResolvedValueOnce(response(memory())).mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { resolveNew = resolve; }) } as Response);
  const start = renders.length; rerender({ enabled: true, refresh: 0 });
  expect(renders.slice(start).every(row => row.pending && row.ref === null && row.entries.length === 0)).toBe(true);
  await waitFor(() => expect(resolveNew).toBeDefined());
  await act(async () => { resolveNew({ items: wardrobe }); }); await waitFor(() => expect(result.current.ref).not.toBeNull());
  const updated = memory(); updated.boards[0].exclusionSets![0].revision = 7;
  fetchMock.mockResolvedValueOnce(response(updated)).mockResolvedValueOnce(response({ items: wardrobe }));
  rerender({ enabled: true, refresh: 1 }); expect(result.current).toMatchObject({ pending: true, ref: null, entries: [] });
  await waitFor(() => expect(result.current.ref?.revision).toBe(7));
  expect(fetchMock.mock.calls.every(call => call[1].method === "GET" || call[1].method == null)).toBe(true);
});

it("aborts an unmounted read before a delayed token can start any GET", async () => {
  let resolveToken!: (token: string) => void;
  const person = { uid: "delayed-token-owner", getIdToken: () => new Promise<string>(resolve => { resolveToken = resolve; }) };
  const { unmount } = renderHook(() => useExclusionPreview(person, context, true));
  await waitFor(() => expect(resolveToken).toBeDefined()); unmount();
  await act(async () => { resolveToken("late-token"); }); expect(fetchMock).not.toHaveBeenCalled();
});

it("displays pending/error states without stale names, and retry only calls the supplied read callback", async () => {
  const retry = jest.fn();
  const preview: ExclusionPreview = { pending: true, error: "", ref: null, entries: [{ kind: "item", names: ["Old private name"] }], retry };
  const { rerender } = render(<ApplicableExclusions preview={preview} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading saved exclusions"); expect(screen.queryByText(/Old private/)).not.toBeInTheDocument();
  rerender(<ApplicableExclusions preview={{ ...preview, pending: false, error: "Read failed" }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Read failed"); expect(screen.queryByText(/Old private/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry exclusions" })); expect(retry).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
});
