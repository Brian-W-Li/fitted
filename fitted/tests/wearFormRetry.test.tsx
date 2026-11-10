import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import WearForm, { type SuggestionView, type ExperienceView } from "@/app/(app)/memory/WearForm";

const user = { uid: "retry-owner", getIdToken: jest.fn().mockResolvedValue("token") } as unknown as User;
const suggestion: SuggestionView = { snapshotId: "650000000000000000000001", candidateId: "c0", suggestionContext: "Lunch", items: [] };

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn()
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222") });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("holds one report and operation ID through failed acknowledgement and remount", async () => {
  const fetchMock = jest.fn()
    .mockRejectedValueOnce(new Error("ack lost"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) } as Response);
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const first = render(<WearForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Actual situation" }), { target: { value: "Lunch" } });
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  await screen.findByText(/held for a safe retry/);
  const original = fetchMock.mock.calls[0][1]?.body;
  expect(JSON.parse(original as string)).toMatchObject({ experienceId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222" });
  expect(localStorage.length).toBe(1);
  first.unmount();
  render(<WearForm user={user} suggestion={suggestion} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved report" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1]?.body).toEqual(original);
  await screen.findByText(/Wear report saved/);
  expect(localStorage.length).toBe(0);
});


it("acknowledges a successful write even when browser storage is disabled", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const saved = jest.fn();
  render(<WearForm user={user} suggestion={suggestion} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Wear report saved");
  expect(saved).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([true, false])("preserves timezone and handles confirmed context explicitly after redaction (confirmed=%s)", async confirmed => {
  const report: ExperienceView = { experienceId: "wear-1", currentRevision: 2, lifecycle: "active", sourceAvailable: false,
    source: null, items: [], sourceItems: [], state: { occurredOn: "2026-01-01", timezone: "Pacific/Honolulu",
      context: { rawOccasion: "Dinner", source: "suggestion", confirmed: true }, outcome: "unknown" } };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 3 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<WearForm user={user} experience={report} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct wear report" }));
  if (!confirmed) fireEvent.click(screen.getByRole("checkbox", { name: /I wore it for the suggested situation/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "How did it go?" }), { target: { value: "worked" } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Wear report saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ occurredOn: "2026-01-01", timezone: "Pacific/Honolulu",
    context: confirmed ? { kind: "suggestion", confirmed: true } : { kind: "user", text: "" }, outcome: "worked" });
});

it("does not let an abandoned form discard a pending save or notify its parent", async () => {
  let finish!: (value: unknown) => void;
  const fetchMock = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const saved = jest.fn();
  const view = render(<WearForm user={user} suggestion={suggestion} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) }));
  expect(saved).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
});


it("keeps an acknowledged-on-server correction retry intact when its JSON body arrives after remount", async () => {
  const report: ExperienceView = { experienceId: "wear-body-race", currentRevision: 1, lifecycle: "active", sourceAvailable: true,
    source: { snapshotId: suggestion.snapshotId, candidateId: suggestion.candidateId }, items: [], sourceItems: [],
    state: { occurredOn: "2026-01-01", timezone: "UTC", context: { rawOccasion: "Class", source: "user", confirmed: true }, outcome: "unknown", compositionStatus: "as_shown" } };
  let finishBody!: (value: unknown) => void;
  const body = new Promise(resolve => { finishBody = resolve; });
  const readBody = jest.fn(() => body);
  const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: readBody })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ acknowledgedRevision: 2 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const oldSaved = jest.fn(), currentSaved = jest.fn();
  const first = render(<WearForm user={user} experience={report} onSaved={oldSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct wear report" }));
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
  const original = fetchMock.mock.calls[0][1];
  expect(original.method).toBe("PATCH");
  expect(JSON.parse(original.body)).toMatchObject({ expectedPreviousRevision: 1, operationId: expect.any(String) });
  first.unmount();
  render(<WearForm user={user} experience={{ ...report, currentRevision: 2 }} onSaved={currentSaved} />);
  await screen.findByRole("button", { name: "Retry saved report" });
  const pending = localStorage.getItem(`fitted:wear:${user.uid}:${report.experienceId}`);
  await act(async () => { finishBody({ acknowledgedRevision: 2 }); await body; });
  expect(oldSaved).not.toHaveBeenCalled();
  expect(currentSaved).not.toHaveBeenCalled();
  expect(localStorage.getItem(`fitted:wear:${user.uid}:${report.experienceId}`)).toBe(pending);
  fireEvent.click(screen.getByRole("button", { name: "Retry saved report" }));
  await screen.findByText(/Wear report saved/);
  expect(fetchMock.mock.calls[1][1].body).toBe(original.body);
  expect(currentSaved).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(`fitted:wear:${user.uid}:${report.experienceId}`)).toBeNull();
});
