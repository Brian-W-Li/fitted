import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { User } from "firebase/auth";
import VariationForm from "@/app/(app)/memory/VariationForm";
import type { ExperienceView } from "@/app/(app)/memory/WearForm";

const user = { uid: "variation-owner", getIdToken: jest.fn().mockResolvedValue("token") } as unknown as User;
const source = { snapshotId: "650000000000000000000001", candidateId: "c0" };
const experience: ExperienceView = {
  experienceId: "wear-1", lifecycle: "active", currentRevision: 1, sourceAvailable: true, source,
  state: { occurredOn: "2026-10-09", timezone: "UTC", context: { rawOccasion: "Class", source: "user", confirmed: true }, outcome: "worked" },
  items: [
    { itemId: "650000000000000000000002", name: "Green shirt", clothingType: "top", availability: "available", changed: false },
    { itemId: "650000000000000000000003", name: "Blue jeans", clothingType: "bottom", availability: "available", changed: false },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn().mockReturnValue("11111111-1111-4111-8111-111111111111") });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("keeps the past wear distinct from a new-occasion proposal with one exact piece left out", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    shown: [{ snapshotId: "650000000000000000000004", candidateId: "new", displayItems: [
      { itemId: experience.items[0].itemId, name: "Green shirt" },
      { itemId: "650000000000000000000005", name: "Black trousers" },
    ], styleMove: { oneSentence: "Dress up the green shirt." } }],
    flags: { notEnoughItems: false, insufficientAfterGeneration: false, reasonHint: null },
  }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("Leave out this old piece"), { target: { value: experience.items[1].itemId } });
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  expect(await screen.findByText("New proposal for Dinner")).toBeInTheDocument();
  expect(screen.getByText("These are new suggestions from your current closet. If you wore one, report that separately.")).toBeInTheDocument();
  expect(screen.getByText("Kept Green shirt; left out Blue jeans.")).toBeInTheDocument();
  const [path, init] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/recommend");
  expect(JSON.parse(init.body)).toEqual({ requestId: "11111111-1111-4111-8111-111111111111", parentSnapshotId: source.snapshotId,
    variation: { sourceCandidateId: "c0", anchorItemId: experience.items[0].itemId,
      leaveOutItemId: experience.items[1].itemId, occasion: "Dinner" } });
  expect(screen.getByRole("link", { name: "Open saved proposal / report wear" })).toHaveAttribute("href",
    "/memory/proposal?snapshotId=650000000000000000000004&candidateId=new");
  expect(sessionStorage.length).toBe(0);
  fireEvent.change(screen.getByRole("combobox", { name: "Keep this piece" }), { target: { value: experience.items[1].itemId } });
  expect(screen.queryByText("New proposal for Dinner")).not.toBeInTheDocument();
});

it("retains the same request and choices across a lost acknowledgement and remount", async () => {
  const fetchMock = jest.fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ shown: [], flags: { notEnoughItems: true } }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const first = render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("Leave out this old piece"), { target: { value: experience.items[1].itemId } });
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Retry with the same request");
  const original = fetchMock.mock.calls[0][1].body;
  expect(sessionStorage.length).toBe(1);
  first.unmount();
  render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1].body).toBe(original);
  expect(await screen.findByText(/No outfit met those exact choices/)).toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
});

it("adapts a changed report from actual pieces, including one absent from the suggestion", async () => {
  const actual = { ...experience, state: { ...experience.state, compositionStatus: "changed" as const }, sourceAvailable: false, source: null,
    sourceItems: [], items: [experience.items[0], { itemId: "650000000000000000000006", name: "Black trousers", clothingType: "bottom", availability: "available" as const, changed: true }] };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ shown: [] }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} experience={actual} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  expect(screen.getByText(/actual pieces you reported wearing/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Leave out this old piece"), { target: { value: "650000000000000000000006" } });
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ requestId: "11111111-1111-4111-8111-111111111111",
    actualVariation: { experienceId: "wear-1", expectedRevision: 1, anchorItemId: actual.items[0].itemId,
      leaveOutItemId: "650000000000000000000006", occasion: "Dinner" } });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("parentSnapshotId");
  expect(screen.getByText(/original suggestion is recorded separately/)).toBeInTheDocument();
});

it("keeps source-redacted as-shown reports unavailable for variation", () => {
  const redacted = { ...experience, sourceAvailable: false, source: null };
  render(<VariationForm user={user} experience={redacted} />);
  expect(screen.queryByRole("button", { name: "Make another outfit" })).not.toBeInTheDocument();
});

it("does not offer variation when the historical source is gone or two current pieces are unavailable", () => {
  const unavailable = { ...experience, items: experience.items.map(item => ({ ...item, availability: "unavailable" as const })) };
  const view = render(<VariationForm user={user} experience={unavailable} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  expect(screen.getByText(/needs a currently available piece/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Find an outfit" })).not.toBeInTheDocument();
  view.rerender(<VariationForm user={user} experience={{ ...experience, sourceAvailable: false, source: null }} />);
  expect(screen.queryByRole("button", { name: "Make another outfit" })).not.toBeInTheDocument();
});

it("asks for a different reported situation before spending a render", async () => {
  const fetchMock = jest.fn();
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: " class " } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Describe a different situation");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("discards a proposal response from an older wear revision", async () => {
  let finish!: (response: unknown) => void;
  const fetchMock = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const changed = { ...experience, state: { ...experience.state, compositionStatus: "changed" as const } };
  const view = render(<VariationForm user={user} experience={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.rerender(<VariationForm user={user} experience={{ ...changed, currentRevision: 2 }} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "New situation" })).toBeEnabled());
  await act(async () => finish({ ok: true, json: async () => ({ shown: [
    { snapshotId: "650000000000000000000004", candidateId: "stale", displayItems: changed.items },
  ] }) }));
  expect(screen.queryByText("New proposal for Dinner")).not.toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
});

const suggestion = { ...source, suggestionContext: "Class", items: experience.items, shownVariationAllowed: true };

it("adapts a proposal without a wear record and preserves a retry after unmount", async () => {
  let finish!: (value: unknown) => void;
  const fetchMock = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ok: true, json: async () => ({ shown: [] }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const view = render(<VariationForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  expect(screen.getByText(/does not change plans, likes or wear reports/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const body = fetchMock.mock.calls[0][1].body;
  expect(JSON.parse(body)).toMatchObject({ parentSnapshotId: source.snapshotId, variation: { sourceCandidateId: "c0", occasion: "Dinner" } });
  expect(JSON.parse(body)).not.toHaveProperty("actualVariation");
  view.unmount();
  await act(async () => finish({ ok: true, json: async () => ({ shown: [] }) }));
  expect(sessionStorage.length).toBe(1);
  render(<VariationForm user={user} suggestion={suggestion} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(sessionStorage.length).toBe(0));
  expect(fetchMock.mock.calls[1][1].body).toBe(body);
});

it("routes report-bound proposals to current wear memory", () => {
  render(<VariationForm user={user} suggestion={{ ...suggestion, shownVariationAllowed: false }} />);
  expect(screen.getByRole("link", { name: "open wear memory" })).toHaveAttribute("href", "/memory");
  expect(screen.queryByRole("button", { name: "Make another outfit" })).not.toBeInTheDocument();
});

it("requires a different proposed situation without implying reported wear", () => {
  const fetchMock = jest.fn();
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New situation" }), { target: { value: " CLASS " } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  expect(screen.getByRole("alert")).toHaveTextContent("original proposal");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("plans a generated alternative inline for the carried day without changing the original intent or wear", async () => {
  const child = { snapshotId: "650000000000000000000004", candidateId: "new", displayItems: [{ itemId: experience.items[0].itemId, name: "Green shirt" }], styleMove: { oneSentence: "A separate dinner option." } };
  const fetchMock = jest.fn(async (path: string) => path === "/api/recommend"
    ? { ok: true, json: async () => ({ shown: [child] }) }
    : { ok: true, json: async () => ({ plannedFor: "2099-10-14" }) }); Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} suggestion={suggestion} initialPlanDay={{ plannedFor: "2099-10-14", timezone: "Pacific/Kiritimati" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("New situation"), { target: { value: "Dinner" } }); fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  const card = (await screen.findByText("A separate dinner option.")).closest("article")!;
  expect(within(card).getByRole("link", { name: "Open saved proposal / report wear" })).toHaveAttribute("href", "/memory/proposal?snapshotId=650000000000000000000004&candidateId=new&plannedFor=2099-10-14&timezone=Pacific%2FKiritimati");
  fireEvent.click(within(card).getByRole("button", { name: "Plan this outfit" }));
  expect(within(card).getByLabelText("Plan for")).toHaveValue("2099-10-14");
  fireEvent.click(within(card).getByRole("button", { name: "Save plan" })); await within(card).findByRole("status");
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/recommend", "/api/plans"]);
  const request = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(request.body as string)).toMatchObject({ snapshotId: child.snapshotId, candidateId: child.candidateId, plannedFor: "2099-10-14", timezone: "Pacific/Kiritimati" });
});

it("adapts with one available source piece and no forced rejection", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ shown: [] }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} experience={{ ...experience,
    items: [experience.items[0], { ...experience.items[1], availability: "unavailable" }] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  expect(screen.getByLabelText("Leave out this old piece")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("New situation"), { target: { value: "Relaxed dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await screen.findByText("New proposal for Relaxed dinner");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).variation).toEqual({ sourceCandidateId: "c0", anchorItemId: experience.items[0].itemId, occasion: "Relaxed dinner" });
  expect(screen.getByText(/same combination may still suit/)).toBeInTheDocument();
});

it("drops an optional exclusion when it becomes the anchor", () => {
  render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("Leave out this old piece"), { target: { value: experience.items[1].itemId } });
  fireEvent.change(screen.getByLabelText("Keep this piece"), { target: { value: experience.items[1].itemId } });
  expect(screen.getByLabelText("Leave out this old piece")).toHaveValue("");
});

it("restores a no-exclusion retry even if the source pieces become unavailable", async () => {
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error("lost acknowledgement"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ shown: [] }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const view = render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("New situation"), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await screen.findByRole("alert");
  const original = fetchMock.mock.calls[0][1].body;
  view.unmount();
  render(<VariationForm user={user} experience={{ ...experience, items: experience.items.map(item => ({ ...item, availability: "unavailable" })) }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1].body).toBe(original);
});

it("ignores malformed stored choices instead of restoring an unusable retry", () => {
  sessionStorage.setItem(`fitted:variation:${user.uid}:${experience.experienceId}:1:${source.snapshotId}:${source.candidateId}`,
    JSON.stringify({ requestId: "11111111-1111-4111-8111-111111111111", parentSnapshotId: source.snapshotId,
      variation: { sourceCandidateId: source.candidateId, anchorItemId: experience.items[0].itemId, occasion: 12 } }));
  render(<VariationForm user={user} experience={experience} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  expect(screen.getByRole("button", { name: "Find an outfit" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument();
});

it("explores a saved situation without inventing a new context and preserves the mode on retry", async () => {
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error("lost acknowledgement"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ shown: [], flags: { insufficientAfterGeneration: true } }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const view = render(<VariationForm user={user} suggestion={{ ...suggestion, suggestionContext: " Class " }} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.click(screen.getByLabelText("Explore the saved situation"));
  expect(screen.getByLabelText("Saved situation")).toHaveValue(" Class ");
  expect(screen.getByLabelText("Saved situation")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Find another combination" }));
  await screen.findByRole("alert");
  const command = fetchMock.mock.calls[0][1].body;
  expect(JSON.parse(command).variation).toEqual({ mode: "explore", sourceCandidateId: "c0", anchorItemId: experience.items[0].itemId, occasion: " Class " });
  expect(screen.getByLabelText("Explore the saved situation")).toBeDisabled();
  view.unmount();
  render(<VariationForm user={user} suggestion={{ ...suggestion, suggestionContext: " Class " }} />);
  expect(await screen.findByLabelText("Saved situation")).toHaveValue(" Class ");
  fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
  await screen.findByText(/No different combination was found/);
  expect(fetchMock.mock.calls[1][1].body).toBe(command);
});

it("adapts an unchanged wear back to the source occasion using its corrected reported context", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ shown: [] }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<VariationForm user={user} experience={{ ...experience, state: { ...experience.state,
    context: { rawOccasion: "Dinner", source: "user", confirmed: true } } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Make another outfit" }));
  fireEvent.change(screen.getByLabelText("New situation"), { target: { value: "Class" } });
  fireEvent.click(screen.getByRole("button", { name: "Find an outfit" }));
  await screen.findByText("New proposal for Class");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).variation.occasion).toBe("Class");
});
