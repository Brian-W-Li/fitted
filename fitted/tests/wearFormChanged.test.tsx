import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { User } from "firebase/auth";
import WearForm, { type SuggestionView, type ExperienceView } from "@/app/(app)/memory/WearForm";

const user = { uid: "wear-owner", getIdToken: jest.fn().mockResolvedValue("token") } as unknown as User;
const top = "650000000000000000000001";
const oldBottom = "650000000000000000000002";
const newBottom = "650000000000000000000003";
const suggestion: SuggestionView = { snapshotId: "650000000000000000000004", candidateId: "c0", suggestionContext: "Class",
  items: [
    { itemId: top, name: "Green shirt", clothingType: "top", availability: "available", changed: false },
    { itemId: oldBottom, name: "Old jeans", clothingType: "bottom", availability: "available", changed: false },
  ] };

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn()
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222") });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("reports only the confirmed changed pieces while retaining the original suggestion ID", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<WearForm user={user} suggestion={suggestion} closet={[{ id: newBottom, name: "Black trousers", clothingType: "bottom", isAvailable: true }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("radio", { name: "I changed some pieces" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Old jeans" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a piece from your closet" }), { target: { value: newBottom } });
  expect(screen.getByRole("list", { name: "Actual pieces" })).toHaveTextContent("Black trousers");
  fireEvent.change(screen.getByRole("textbox", { name: "Actual situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  await screen.findByText(/Wear report saved/);
  const request = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(request).toMatchObject({ snapshotId: suggestion.snapshotId, candidateId: "c0", compositionStatus: "changed",
    memberItemIds: [top, newBottom], context: { kind: "user", text: "Dinner" } });
  expect(request.memberItemIds).not.toContain(oldBottom);
});


it("adds an explicitly eligible mid layer and sends both tops as actual members", async () => {
  const mid = "650000000000000000000005";
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<WearForm user={user} suggestion={suggestion} closet={[{ id: mid, name: "Quarter zip", clothingType: "top", layerRole: "mid" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("radio", { name: "I changed some pieces" }));
  expect(screen.getByRole("option", { name: "Quarter zip (mid-layer eligible)" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Add a piece from your closet" }), { target: { value: mid } });
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  await screen.findByText(/Wear report saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ compositionStatus: "changed", memberItemIds: [top, oldBottom, mid] });
});

it("shows the saved mid role when reporting a layered suggestion", () => {
  render(<WearForm user={user} suggestion={{ ...suggestion, items: [...suggestion.items,
    { itemId: "650000000000000000000005", name: "Quarter zip", clothingType: "top", role: "mid_layer", availability: "available", changed: false },
  ] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("radio", { name: "I changed some pieces" }));
  expect(screen.getByRole("checkbox", { name: /Quarter zip.*Mid layer/ })).toBeChecked();
  expect(screen.getByRole("list", { name: "Actual pieces" })).toHaveTextContent("Quarter zip (Mid layer)");
});


const capturedReport: ExperienceView = { experienceId: "33333333-3333-4333-8333-333333333333", currentRevision: 2,
  lifecycle: "active", sourceAvailable: false, source: null, sourceItems: [],
  items: [{ itemId: top, name: "Green shirt", clothingType: "top", availability: "available", changed: false, imageUrl: null },
    { itemId: newBottom, name: "Captured trousers", clothingType: "bottom", availability: "missing", changed: false }],
  state: { occurredOn: "2026-01-01", timezone: "America/Los_Angeles", context: { rawOccasion: "Dinner", source: "user", confirmed: true }, outcome: "unknown", compositionStatus: "changed" } };

it("keeps garment photos by default when correcting an outcome", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 3 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<WearForm user={user} experience={capturedReport} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct wear report" }));
  expect(screen.getByRole("checkbox", { name: "Capture current garment photo for Green shirt" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /Capture current garment photo for Captured trousers/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "How did it go?" }), { target: { value: "worked" } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Wear report saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("photoRefreshItemIds");
});

it("holds an explicitly requested current garment-photo capture through a retry", async () => {
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error("ack lost"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ acknowledgedRevision: 3 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  const form = render(<WearForm user={user} experience={capturedReport} />);
  fireEvent.click(screen.getByRole("button", { name: "Correct wear report" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Capture current garment photo for Green shirt" }));
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText(/held for a safe retry/);
  const command = fetchMock.mock.calls[0][1].body;
  expect(JSON.parse(command)).toMatchObject({ photoRefreshItemIds: [top], expectedPreviousRevision: 2 });
  form.unmount();
  render(<WearForm user={user} experience={capturedReport} />);
  expect(await screen.findByRole("checkbox", { name: "Capture current garment photo for Green shirt" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Capture current garment photo for Green shirt" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry saved report" }));
  await screen.findByText(/Wear report saved/);
  expect(fetchMock.mock.calls[1][1].body).toBe(command);
});
