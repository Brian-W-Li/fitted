import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StyleDirectionPanel from "@/app/(app)/dashboard/StyleDirectionPanel";
import { emptyStyleMemory, type StyleMemoryCommand, type StyleMemoryState } from "@/lib/styleMemory/contract";
import { applyStyleCommand, publicStyleMemory } from "@/lib/styleMemory/state";
import { parseStyleMemoryCommand } from "@/lib/styleMemory/validation";

const boardId = "a".repeat(24), profileId = "b".repeat(24), routineId = "c".repeat(24);
const board = { id: boardId, profileId, label: "Campus", status: "active" as const, currentVersion: 1,
  versions: [{ version: 1, createdAt: "2026-11-09T00:00:00.000Z", rawSource: "relaxed", compiled: { aestheticKeywords: ["relaxed"], palette: ["olive"], patterns: [], fits: [] } }],
  learningOptIns: [], defaultRoutineId: routineId };
const routine = { id: routineId, label: "Class", status: "active" as const, currentVersion: 1,
  versions: [{ version: 1, createdAt: "2026-11-09T00:00:00.000Z", label: "Class" }] };
const empty = (): StyleMemoryState => ({ revision: 0, boards: [], routines: [], selectedBoardId: null, selectedRoutineId: null });
const available = (): StyleMemoryState => ({ ...empty(), revision: 3, boards: [board], routines: [routine] });
const selected = (): StyleMemoryState => ({ ...available(), selectedBoardId: boardId, selectedRoutineId: routineId });
const user = { uid: "owner-a", getIdToken: jest.fn(async () => "owner-token") };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
const receipt = (state: StyleMemoryState, command: StyleMemoryCommand) => response({ state, operation: { id: command.operationId, revision: state.revision } });
let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn(); global.fetch = fetchMock;
  let sequence = 0;
  Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `${(++sequence).toString(16).padStart(8, "0")}-1234-4123-8123-123456789abc`) });
});
const commandAt = (index: number): StyleMemoryCommand => JSON.parse(fetchMock.mock.calls[index][1].body);

it("restores only acknowledged choices and describes opt-in without claiming an active model", async () => {
  const state = selected(); state.boards = [{ ...board, learningOptIns: [{ profileVersion: 1, routineId, routineVersion: 1, enabled: true }] }];
  fetchMock.mockResolvedValue(response(state));
  const change = jest.fn(), pending = jest.fn();
  render(<StyleDirectionPanel user={user} onChange={change} onPendingChange={pending} />);
  expect(screen.getByText("Loading saved directions…")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveValue(boardId));
  expect(screen.getByRole("combobox", { name: "Saved situation" })).toHaveValue(routineId);
  expect(screen.getByRole("checkbox", { name: /Use experimental taste learning/ })).toBeChecked();
  expect(screen.getByText(/does not mean a learned model is active yet/)).toBeInTheDocument();
  expect(change).toHaveBeenLastCalledWith({ boardId, profileId, profileVersion: 1, routineId, routineVersion: 1, learningEnabled: true });
  expect(pending).toHaveBeenLastCalledWith(false);
});

it("reviews explicit phrase chips and optional fields before creating a direction without selecting or enabling it", async () => {
  fetchMock.mockResolvedValueOnce(response(empty())).mockImplementationOnce(async (_url, options) => {
    const command = parseStyleMemoryCommand(JSON.parse(options.body));
    const data = emptyStyleMemory();
    // Accept the command only if the real server transition accepts its identities and fields.
    applyStyleCommand(data, command, 1, "2026-11-09T00:00:00.000Z");
    return receipt(publicStyleMemory(data, 1), command);
  });
  render(<StyleDirectionPanel user={user} onChange={jest.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "New direction" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Saved choice name" }), "Easy campus");
  await userEvent.type(screen.getByRole("textbox", { name: "Style word or phrase" }), "Relaxed shape");
  await userEvent.click(screen.getByRole("button", { name: "Add style phrase" }));
  await userEvent.click(screen.getByText("Optional palette, pattern and cut"));
  await userEvent.type(screen.getByRole("textbox", { name: "Palette (comma separated)" }), "Olive, cream");
  await userEvent.click(screen.getByRole("button", { name: "Review direction" }));
  expect(within(screen.getByLabelText("Direction review")).getByText("Relaxed shape")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Save direction" }));
  await screen.findByText("Saved. Choose it above when you're ready.");
  expect(commandAt(1)).toMatchObject({ kind: "create_board", label: "Easy campus", expectedRevision: 0, rawSource: "Relaxed shape",
    compiled: { aestheticKeywords: ["Relaxed shape"], palette: ["olive", "cream"], patterns: [], fits: [] } });
  expect(commandAt(1)).toMatchObject({ id: expect.stringMatching(/^[a-f0-9]{24}$/), profileId: expect.stringMatching(/^[a-f0-9]{24}$/) });
  const creation = commandAt(1) as Extract<StyleMemoryCommand, { kind: "create_board" }>;
  expect(creation.id).not.toBe(creation.profileId);
  expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveValue("");
});

it("ignores an old owner's delayed response after the signed-in owner changes", async () => {
  let finishOld!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(response(empty()));
  const change = jest.fn();
  const { rerender } = render(<StyleDirectionPanel user={user} onChange={change} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  rerender(<StyleDirectionPanel user={{ uid: "owner-b", getIdToken: async () => "token-b" }} onChange={change} />);
  await screen.findByRole("button", { name: "New direction" });
  await act(async () => { finishOld(response(selected())); });
  expect(screen.queryByRole("option", { name: "Campus" })).not.toBeInTheDocument();
  expect(change.mock.calls.every(([context]) => context === null)).toBe(true);
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer token-b");
});

it("does not dispatch a delayed old-owner mutation after sign-out", async () => {
  let finishToken!: (value: string) => void;
  const getIdToken = jest.fn().mockResolvedValueOnce("first-token").mockImplementationOnce(() => new Promise(resolve => { finishToken = resolve; }));
  fetchMock.mockResolvedValue(response(available()));
  const change = jest.fn();
  const { rerender } = render(<StyleDirectionPanel user={{ uid: "owner-a", getIdToken }} onChange={change} />);
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Style direction" }), boardId);
  await waitFor(() => expect(getIdToken).toHaveBeenCalledTimes(2));
  rerender(<StyleDirectionPanel user={null} onChange={change} />);
  await act(async () => { finishToken("old-token"); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole("region", { name: "Saved style direction" })).not.toBeInTheDocument();
});

it("holds an uncertain write and retries its exact operation instead of creating another mutation", async () => {
  fetchMock.mockResolvedValueOnce(response(available())).mockRejectedValueOnce(new Error("network lost"))
    .mockImplementationOnce(async (_url, options) => receipt({ ...selected(), revision: 4 }, JSON.parse(options.body)));
  const change = jest.fn(), pending = jest.fn();
  render(<StyleDirectionPanel user={user} onChange={change} onPendingChange={pending} />);
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Style direction" }), boardId);
  await screen.findByRole("button", { name: "Retry same change" });
  expect(screen.getByRole("combobox", { name: "Style direction" })).toBeDisabled();
  expect(change).toHaveBeenLastCalledWith(null);
  expect(pending).toHaveBeenLastCalledWith(true);
  const original = commandAt(1);
  await userEvent.click(screen.getByRole("button", { name: "Retry same change" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveValue(boardId));
  expect(commandAt(2)).toEqual(original);
  expect(original).toMatchObject({ kind: "select_context", expectedRevision: 3, boardId, routineId });
  expect(pending).toHaveBeenLastCalledWith(false);
});

it("refreshes a revision conflict without automatically repeating the rejected edit", async () => {
  fetchMock.mockResolvedValueOnce(response(selected())).mockResolvedValueOnce(response({ error: "Revision conflict", code: "revision_conflict" }, 409))
    .mockResolvedValueOnce(response({ ...selected(), revision: 9 }));
  const pending = jest.fn();
  render(<StyleDirectionPanel user={user} onChange={jest.fn()} onPendingChange={pending} />);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Use experimental taste learning/ }));
  await screen.findByText(/Saved directions changed elsewhere/);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2][1].method).toBe("GET");
  expect(screen.queryByRole("button", { name: "Retry same change" })).not.toBeInTheDocument();
  expect(pending).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("checkbox", { name: /Use experimental taste learning/ })).not.toBeChecked();
});

it("offers archive separately and shows erase consequences before issuing a destructive command", async () => {
  fetchMock.mockResolvedValue(response(selected()));
  render(<StyleDirectionPanel user={user} onChange={jest.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Manage saved choices" }));
  expect(screen.getByRole("button", { name: "Archive: Campus" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Erase: Campus" }));
  expect(screen.getByRole("alertdialog", { name: "Erase Campus" })).toHaveTextContent("Linked outfit proposals and plans become unavailable");
  expect(screen.getByRole("alertdialog", { name: "Erase Campus" })).toHaveTextContent("Independently reported wears remain");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Keep this saved choice" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not enable learning without a saved situation and allows a read failure to settle without pretending context loaded", async () => {
  fetchMock.mockResolvedValueOnce(response({ ...available(), selectedBoardId: boardId })).mockRejectedValueOnce(new Error("offline"));
  const change = jest.fn(), pending = jest.fn();
  const { rerender } = render(<StyleDirectionPanel user={user} onChange={change} onPendingChange={pending} />);
  await screen.findByText(/Choose a saved direction and situation to enable it/);
  expect(screen.queryByRole("checkbox", { name: /Use experimental taste learning/ })).not.toBeInTheDocument();
  rerender(<StyleDirectionPanel user={{ uid: "new-owner", getIdToken: async () => "other" }} onChange={change} onPendingChange={pending} />);
  await screen.findByRole("button", { name: "Retry saved directions" });
  expect(change).toHaveBeenLastCalledWith(null);
  expect(pending).toHaveBeenLastCalledWith(false);
});

it("creates successive directions with distinct server-valid Board, profile and operation identities", async () => {
  const data = emptyStyleMemory(); let revision = 0;
  fetchMock.mockImplementation(async (_url, options) => {
    if (options.method === "GET") return response(publicStyleMemory(data, revision));
    const command = parseStyleMemoryCommand(JSON.parse(options.body));
    expect(command.expectedRevision).toBe(revision);
    applyStyleCommand(data, command, ++revision, "2026-11-09T00:00:00.000Z");
    return receipt(publicStyleMemory(data, revision), command);
  });
  render(<StyleDirectionPanel user={user} onChange={jest.fn()} />);
  for (const label of ["Easy campus", "Quiet weekend"]) {
    await userEvent.click(await screen.findByRole("button", { name: "New direction" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Saved choice name" }), label);
    await userEvent.type(screen.getByRole("textbox", { name: "Style word or phrase" }), "relaxed");
    await userEvent.click(screen.getByRole("button", { name: "Add style phrase" }));
    await userEvent.click(screen.getByRole("button", { name: "Review direction" }));
    await userEvent.click(screen.getByRole("button", { name: "Save direction" }));
    await screen.findByText("Saved. Choose it above when you're ready.");
  }
  expect(data.boards.map(row => row.label)).toEqual(["Easy campus", "Quiet weekend"]);
  expect(new Set(data.boards.flatMap(row => [row.id, row.profileId])).size).toBe(4);
  const posts = fetchMock.mock.calls.filter(([, options]) => options.method === "POST").map(([, options]) => JSON.parse(options.body));
  expect(posts).toHaveLength(2);
  expect(new Set(posts.map(command => command.operationId)).size).toBe(2);
  expect(screen.getByRole("combobox", { name: "Style direction" })).toHaveValue("");
});
