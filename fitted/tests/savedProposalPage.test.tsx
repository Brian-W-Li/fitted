import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
let mockAuthCallback: (user: User | null) => void;
let mockParams = "snapshotId=650000000000000000000001&candidateId=c0";
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_: unknown, callback: typeof mockAuthCallback) => {
  mockAuthCallback = callback; callback({ uid: "u1", getIdToken: async () => "u1" } as User); return () => {};
} }));
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mockParams) }));
import ProposalPage from "@/app/(app)/memory/proposal/page";
const suggestion = { snapshotId: "650000000000000000000001", candidateId: "c0", suggestionContext: "Dinner", weatherContext: "Light rain, 16°C",
  styleMove: { oneSentence: "Tuck the shirt for dinner." }, items: [
    { itemId: "650000000000000000000002", name: "Green shirt", availability: "unavailable", changed: true },
  ] };
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body } as Response);
beforeEach(() => { sessionStorage.clear(); mockParams = "snapshotId=650000000000000000000001&candidateId=c0"; });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
it("renders saved pieces, styling and current availability without generating or recording wear", async () => {
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion })) as typeof fetch;
  render(<ProposalPage />);
  expect(await screen.findByText("Tuck the shirt for dinner.")).toBeInTheDocument();
  expect(screen.getByText(/Saved weather context: Light rain, 16°C/)).toBeInTheDocument();
  expect(screen.getByText("currently unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Report what I wore" })).toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.every(([path]) => !String(path).includes("recommend"))).toBe(true);
});
it("shows unavailable proposals without exposing wear controls", async () => {
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({}, false, 404)) as typeof fetch;
  render(<ProposalPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
  expect(screen.queryByRole("button", { name: "Report what I wore" })).not.toBeInTheDocument();
});
it("discards a delayed proposal after an account or exact-link change", async () => {
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { finish = resolve; });
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : delayed) as typeof fetch;
  const view = render(<ProposalPage />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  mockParams = "snapshotId=650000000000000000000001&candidateId=c1";
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({}, false, 404)) as typeof fetch;
  act(() => mockAuthCallback({ uid: "u2", getIdToken: async () => "u2" } as User));
  view.rerender(<ProposalPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
  await act(async () => finish(response({ suggestion })));
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Report what I wore" })).not.toBeInTheDocument();
});

it("rechecks visibility when returning to the tab and removes a now-redacted proposal", async () => {
  const fetchMock = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion }));
  global.fetch = fetchMock as typeof fetch;
  render(<ProposalPage />);
  expect(await screen.findByText("Green shirt")).toBeInTheDocument();
  fetchMock.mockImplementation(async () => response({}, false, 404));
  fireEvent.focus(window);
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
  expect(screen.queryByRole("button", { name: "Report what I wore" })).not.toBeInTheDocument();
});

it("carries a validated plan day only to planning, never to the actual wear date", async () => {
  mockParams += "&plannedFor=2099-10-14&timezone=Pacific%2FKiritimati";
  const available = { ...suggestion, items: suggestion.items.map(item => ({ ...item, availability: "available" })) };
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion: available })) as typeof fetch;
  render(<ProposalPage />); await screen.findByText("Green shirt"); fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  expect(screen.getByLabelText("Plan for")).toHaveValue("2099-10-14"); expect(screen.getByText(/Day in Pacific\/Kiritimati/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" })); expect(screen.getByLabelText("Date worn")).not.toHaveValue("2099-10-14");
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method)).toBe(true);
});
it("ignores malformed planning hints while keeping the exact proposal readable", async () => {
  mockParams += "&plannedFor=2099-02-29&timezone=Not%2FAZone";
  const available = { ...suggestion, items: suggestion.items.map(item => ({ ...item, availability: "available" })) };
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion: available })) as typeof fetch;
  render(<ProposalPage />); await screen.findByText("Green shirt"); fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  expect(screen.getByLabelText("Plan for")).not.toHaveValue("2099-02-29"); expect(screen.queryByText(/Not\/AZone/)).not.toBeInTheDocument();
});

it.each([
  ["manual", "Your expected conditions"], ["current", "Fetched current conditions"], ["forecast", "Fetched forecast"],
  ["occasion", "Inferred from the event description"], ["default", "Fallback assumption"], [undefined, "Source not recorded"],
])("labels saved weather source %s without inventing provenance or a current forecast", async (weatherSource, label) => {
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion: { ...suggestion, weatherSource } })) as typeof fetch;
  render(<ProposalPage />);
  expect(await screen.findByText(new RegExp(`Weather source: ${label}`))).toHaveTextContent("not a current forecast or a guarantee of suitability");
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method)).toBe(true);
});

it("renders the saved proposal's composition-specific layer note without generating", async () => {
  const note = "The original suggestions included an optional removable-layer option. This proposal does not include a layer. Rain and wind protection are unknown.";
  global.fetch = jest.fn(async (path: string) => path.startsWith("/api/wardrobe") ? response({ items: [] }) : response({ suggestion: { ...suggestion, layerChoice: { status: "offered", note } } })) as typeof fetch;
  render(<ProposalPage />); expect(await screen.findByText(note)).toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method)).toBe(true);
});
