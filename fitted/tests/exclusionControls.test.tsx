/** Client contract tests only: owned GETs and parent acknowledgements are authored fixtures, not server integration. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import ExclusionControls from "@/app/(app)/dashboard/ExclusionControls";
import type { ExclusionInput } from "@/lib/explicitExclusions";
import type { SavedExclusionEntry, StyleContextSelection, StyleMemoryState } from "@/lib/styleMemory/contract";
const id = (number: number) => number.toString(16).padStart(24, "0");
const context: StyleContextSelection = { boardId: id(1), profileId: id(2), profileVersion: 1, routineId: id(3), routineVersion: 1, learningEnabled: false };
const wardrobe = [
  { id: id(11), name: "Authored shirt", imagePath: `mongo:${id(101)}`, isAvailable: true },
  { id: id(12), name: "Authored trousers", imageUrl: `/api/images/${id(102)}`, isAvailable: true },
  { id: id(13), name: "Authored dress", isAvailable: true },
  { id: id(14), name: "Authored coat", isAvailable: false },
];
const rule = (itemId: string, kind: "item" | "combination" = "item"): SavedExclusionEntry => ({ id: id(200 + parseInt(itemId.slice(-2), 16)), revision: 7, kind, itemIds: [itemId] });
function memory(entries: SavedExclusionEntry[] = [], setRevision = 7): StyleMemoryState {
  return { revision: setRevision, selectedBoardId: context.boardId, selectedRoutineId: context.routineId, boards: [{ id: context.boardId, profileId: context.profileId,
    label: "Campus", status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: "2026-11-15T00:00:00Z", rawSource: "relaxed",
      compiled: { aestheticKeywords: ["relaxed"], palette: [], patterns: [], fits: [] } }], learningOptIns: [],
    exclusionSets: entries.length ? [{ id: id(4), revision: setRevision, profileVersion: 1, routineId: context.routineId, routineVersion: 1, entries }] : [] }],
    routines: [{ id: context.routineId!, label: "Class", status: "active", currentVersion: 1, versions: [{ version: 1, createdAt: "2026-11-15T00:00:00Z", label: "Class" }] }] };
}
const response = (items: typeof wardrobe, ok = true) => ({ ok, json: async () => ({ items }) }) as Response;
const user = { uid: "owner-a", getIdToken: jest.fn(async () => "owner-token") };
function props() { return { user, memory: memory(), context, disabled: false, oneRequest: { itemIds: [], outfitItemIds: [] } as ExclusionInput,
  onOneRequestChange: jest.fn(), onSave: jest.fn() }; }
const open = async () => userEvent.click(screen.getByText("Leave pieces or an exact outfit out"));
let fetchMock: jest.Mock;
beforeEach(() => { fetchMock = jest.fn(async () => response(wardrobe)); global.fetch = fetchMock; user.getIdToken.mockClear(); });

it("loads owned pictures lazily and updates only the explicit next-request draft on submit", async () => {
  const p = props();
  function Draft() { const [input, setInput] = useState(p.oneRequest); return <ExclusionControls {...p} oneRequest={input} onOneRequestChange={next => { p.onOneRequestChange(next); setInput(next); }} />; }
  render(<Draft />);
  expect(fetchMock).not.toHaveBeenCalled(); await open();
  await userEvent.click(await screen.findByRole("radio", { name: "Authored shirt" }));
  expect(p.onOneRequestChange).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Exclusion scope" })).toHaveValue("request");
  await userEvent.click(screen.getByRole("button", { name: "Leave out on next request" }));
  expect(p.onOneRequestChange).toHaveBeenCalledTimes(1);
  expect(p.onOneRequestChange).toHaveBeenCalledWith({ itemIds: [id(11)], outfitItemIds: [] });
  expect(within(screen.getByRole("list", { name: "Next-request exclusions" })).getByText("One piece: Authored shirt")).toBeInTheDocument();
  expect(p.onSave).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]).toEqual(["/api/wardrobe", expect.objectContaining({ headers: { Authorization: "Bearer owner-token" }, signal: expect.any(AbortSignal) })]);
  expect(screen.getAllByRole("presentation").map(image => image.getAttribute("src"))).toContain(`/api/images/${id(101)}`);
});

it("keeps exact membership separate from piece bans, allows a one-piece dress and rejects duplicate/five-plus membership", async () => {
  const p = props(); const many = [...wardrobe, { id: id(15), name: "Authored shoes", isAvailable: true }, { id: id(16), name: "Authored layer", isAvailable: true }];
  fetchMock.mockResolvedValue(response(many)); const { rerender } = render(<ExclusionControls {...p} />); await open();
  await screen.findByRole("radio", { name: "Authored dress" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion type" }), "combination");
  await userEvent.click(screen.getByRole("checkbox", { name: "Authored dress" }));
  await userEvent.click(screen.getByRole("button", { name: "Leave out on next request" }));
  expect(p.onOneRequestChange).toHaveBeenLastCalledWith({ itemIds: [], outfitItemIds: [[id(13)]] });
  rerender(<ExclusionControls {...p} oneRequest={{ itemIds: [], outfitItemIds: [[id(13)]] }} />);
  await userEvent.click(screen.getByRole("button", { name: "Leave out on next request" }));
  expect(screen.getByText("That exclusion is already listed in this scope.")).toBeInTheDocument();
  expect(p.onOneRequestChange).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("checkbox", { name: "Authored dress" }));
  for (const name of ["Authored shirt", "Authored trousers", "Authored coat (currently unavailable)", "Authored shoes", "Authored layer"]) await userEvent.click(screen.getByRole("checkbox", { name }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Authored dress" }));
  expect(screen.getByText("Choose up to five pieces for an exact outfit.")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Authored dress" })).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Leave out on next request" }));
  expect(p.onOneRequestChange).toHaveBeenLastCalledWith({ itemIds: [], outfitItemIds: [[id(11), id(12), id(14), id(15), id(16)], [id(13)]] });
  expect(screen.getByText(/Only this exact full membership/)).toBeInTheDocument();
});

it("sends whole saved lists with the exact scope/revision and waits for parent acknowledgement", async () => {
  const p = props(); p.memory = memory([rule(id(11))]);
  const { rerender } = render(<ExclusionControls {...p} />); await open();
  await userEvent.click(await screen.findByRole("radio", { name: "Authored trousers" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion scope" }), "saved");
  await userEvent.click(screen.getByRole("button", { name: "Save exclusion for this direction and situation" }));
  expect(p.onSave).toHaveBeenCalledTimes(1); expect(p.onSave).toHaveBeenCalledWith({ kind: "set_exclusions", boardId: context.boardId,
    profileVersion: 1, routineId: context.routineId, routineVersion: 1, expectedSetRevision: 7, itemIds: [id(11), id(12)], outfitItemIds: [] });
  expect(p.onOneRequestChange).not.toHaveBeenCalled();
  rerender(<ExclusionControls {...p} disabled />); // Parent has an uncertain/unacknowledged command; old state remains authoritative.
  expect(within(screen.getByRole("list", { name: "Saved exclusions" })).queryByText("One piece: Authored trousers")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Authored trousers" })).toBeChecked();
  expect(within(screen.getByRole("list", { name: "Saved exclusions" })).getByText("One piece: Authored shirt")).toBeInTheDocument();
  rerender(<ExclusionControls {...p} memory={memory([rule(id(11)), rule(id(12))], 8)} />);
  expect(within(screen.getByRole("list", { name: "Saved exclusions" })).getByText("One piece: Authored trousers")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1); // No style-memory API write is owned by this component.
});

it("keeps saved scope unavailable without context and never reassigns a draft after a context switch", async () => {
  const p = props(); p.oneRequest = { itemIds: [id(12)], outfitItemIds: [] };
  const { rerender } = render(<ExclusionControls {...p} />); await open();
  await userEvent.click(await screen.findByRole("radio", { name: "Authored shirt" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion scope" }), "saved");
  rerender(<ExclusionControls {...p} context={null} />);
  expect(screen.getByRole("combobox", { name: "Exclusion scope" })).toHaveValue("request");
  expect(screen.getByRole("option", { name: "This saved direction and situation" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Authored shirt" })).not.toBeChecked();
  expect(within(screen.getByRole("list", { name: "Next-request exclusions" })).getByText("One piece: Authored trousers")).toBeInTheDocument();
  expect(p.onOneRequestChange).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();
});

it("removes deleted references and undoes the same saved set only after the acknowledged removal", async () => {
  const p = props(), missing = id(99); p.memory = memory([rule(missing)]);
  const { rerender } = render(<ExclusionControls {...p} />); await open(); await screen.findByRole("radio", { name: "Authored shirt" });
  const list = screen.getByRole("list", { name: "Saved exclusions" }); expect(within(list).getByText("One piece: Unavailable piece")).toBeInTheDocument();
  await userEvent.click(within(list).getByRole("button", { name: "Remove piece: Unavailable piece" }));
  expect(p.onSave).toHaveBeenLastCalledWith({ kind: "set_exclusions", boardId: context.boardId, profileVersion: 1, routineId: context.routineId, routineVersion: 1,
    expectedSetRevision: 7, itemIds: [], outfitItemIds: [] });
  expect(screen.getByRole("button", { name: "Undo last removal" })).toBeDisabled();
  const acknowledged = memory(); acknowledged.boards[0].exclusionSets = [{ id: id(4), revision: 8, profileVersion: 1, routineId: context.routineId, routineVersion: 1, entries: [] }];
  rerender(<ExclusionControls {...p} memory={acknowledged} />);
  await userEvent.click(screen.getByRole("button", { name: "Undo last removal" }));
  expect(p.onSave).toHaveBeenLastCalledWith({ kind: "set_exclusions", boardId: context.boardId, profileVersion: 1, routineId: context.routineId, routineVersion: 1,
    expectedSetRevision: 8, itemIds: [missing], outfitItemIds: [] });
});

it.each([
  ["request", "item"], ["request", "combination"], ["saved", "item"], ["saved", "combination"],
] as const)("at the twenty-rule %s/%s cap still removes and undoes while additions are refused", async (scope, kind) => {
  const p = props(), items = Array.from({ length: 21 }, (_, index) => ({ id: id(300 + index), name: `Authored piece ${index}`, isAvailable: true }));
  fetchMock.mockResolvedValue(response(items)); const full = items.slice(0, 20).map(item => item.id);
  const input = (ids: string[]): ExclusionInput => kind === "item" ? { itemIds: ids, outfitItemIds: [] } : { itemIds: [], outfitItemIds: ids.map(id => [id]) };
  if (scope === "request") p.oneRequest = input(full); else p.memory = memory(full.map(id => rule(id, kind)));
  const { rerender } = render(<ExclusionControls {...p} />); await open();
  await screen.findByRole("radio", { name: "Authored piece 20" });
  if (scope === "saved") await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion scope" }), "saved");
  if (kind === "combination") await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion type" }), "combination");
  await userEvent.click(screen.getByRole(kind === "item" ? "radio" : "checkbox", { name: "Authored piece 20" }));
  await userEvent.click(screen.getByRole("button", { name: scope === "request" ? "Leave out on next request" : "Save exclusion for this direction and situation" }));
  expect(screen.getByText(/Keep up to 20 piece exclusions/)).toBeInTheDocument();
  expect(p.onOneRequestChange).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("list", { name: scope === "request" ? "Next-request exclusions" : "Saved exclusions" })).getByRole("button", {
    name: `Remove ${kind === "item" ? "piece" : "exact outfit"}: Authored piece 0` }));
  const expected = (ids: string[], revision: number) => scope === "request" ? input(ids) : { kind: "set_exclusions", boardId: context.boardId,
    profileVersion: 1, routineId: context.routineId, routineVersion: 1, expectedSetRevision: revision, ...input(ids) };
  const callback = scope === "request" ? p.onOneRequestChange : p.onSave;
  expect(callback).toHaveBeenLastCalledWith(expected(full.slice(1), 7));
  rerender(<ExclusionControls {...p} oneRequest={scope === "request" ? input(full.slice(1)) : p.oneRequest}
    memory={scope === "saved" ? memory(full.slice(1).map(id => rule(id, kind)), 8) : p.memory} />);
  await userEvent.click(screen.getByRole("button", { name: "Undo last removal" }));
  expect(callback).toHaveBeenLastCalledWith(expected(full, 8));
});

it("can save an unavailable owned piece to an absent null-situation set without enabling learning", async () => {
  const p = props(); p.context = { ...context, routineId: null, routineVersion: null };
  render(<ExclusionControls {...p} />); await open();
  await userEvent.click(await screen.findByRole("radio", { name: "Authored coat (currently unavailable)" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Exclusion scope" }), "saved");
  await userEvent.click(screen.getByRole("button", { name: "Save exclusion for this direction and situation" }));
  expect(p.onSave).toHaveBeenCalledWith({ kind: "set_exclusions", boardId: context.boardId, profileVersion: 1, routineId: null, routineVersion: null,
    expectedSetRevision: 0, itemIds: [id(14)], outfitItemIds: [] });
  expect(p.onOneRequestChange).not.toHaveBeenCalled();
});

it("disabled controls cannot submit or remove rules; load errors allow removal and explicit retry", async () => {
  const p = props(); p.memory = memory([rule(id(11))]); fetchMock.mockRejectedValueOnce(new Error("network"));
  const { rerender } = render(<ExclusionControls {...p} disabled />); await open();
  await screen.findByText(/Couldn't load your wardrobe/);
  expect(screen.getByRole("button", { name: "Retry wardrobe" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Remove piece/ })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /Remove piece/ })); expect(p.onSave).not.toHaveBeenCalled();
  rerender(<ExclusionControls {...p} />);
  await userEvent.click(screen.getByRole("button", { name: "Retry wardrobe" }));
  await screen.findByRole("radio", { name: "Authored shirt" });
  expect(screen.queryByText(/Couldn't load your wardrobe/)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("aborts/fences a former owner's delayed body and aborts an unmounted wardrobe read", async () => {
  const p = props(); let resolveOld!: (body: unknown) => void;
  fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { resolveOld = resolve; }) } as Response);
  const { rerender, unmount } = render(<ExclusionControls {...p} />); await open();
  await waitFor(() => expect(resolveOld).toBeDefined());
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  const nextUser = { uid: "owner-b", getIdToken: jest.fn(async () => "next-token") };
  fetchMock.mockResolvedValueOnce(response([{ id: id(90), name: "New owner's authored piece", isAvailable: true }]));
  rerender(<ExclusionControls {...p} user={nextUser} />); await open();
  await screen.findByRole("radio", { name: "New owner's authored piece" });
  await act(async () => { resolveOld({ items: wardrobe }); });
  expect(oldSignal.aborted).toBe(true); expect(screen.queryByRole("radio", { name: "Authored shirt" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer next-token");
  unmount();
  let resolveLast!: (body: unknown) => void;
  fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise(resolve => { resolveLast = resolve; }) } as Response);
  const last = render(<ExclusionControls {...p} />); await open(); await waitFor(() => expect(resolveLast).toBeDefined());
  const lastSignal = fetchMock.mock.calls[2][1].signal as AbortSignal; last.unmount();
  await act(async () => { resolveLast({ items: wardrobe }); }); expect(lastSignal.aborted).toBe(true);
  expect(p.onOneRequestChange).not.toHaveBeenCalled(); expect(p.onSave).not.toHaveBeenCalled();
});
