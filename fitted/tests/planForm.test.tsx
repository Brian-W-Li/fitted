import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import PlanForm from "@/app/(app)/memory/proposal/PlanForm";
import type { SuggestionView } from "@/app/(app)/memory/WearForm";
const user = { uid: "planner", getIdToken: async () => "token" } as User;
const suggestion: SuggestionView = { snapshotId: "650000000000000000000001", candidateId: "c0", suggestionContext: "Dinner",
  items: [{ itemId: "650000000000000000000002", name: "Green shirt", clothingType: "top", availability: "available", changed: false }] };
beforeEach(() => { sessionStorage.clear(); Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "11111111-1111-4111-8111-111111111111" }); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
it("holds the same planning identity through lost acknowledgement and remount, keeping intent distinct", async () => {
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error("ack lost")).mockResolvedValueOnce({ ok: true, json: async () => ({ plannedFor: "2099-10-11" }) });
  global.fetch = fetchMock as typeof fetch;
  const view = render(<PlanForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  fireEvent.change(screen.getByLabelText("Plan for"), { target: { value: "2099-10-11" } });
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  await screen.findByRole("alert"); const body = fetchMock.mock.calls[0][1].body;
  view.unmount(); render(<PlanForm user={user} suggestion={suggestion} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry same plan" }));
  expect(await screen.findByRole("status")).toHaveTextContent("This is intent, not a wear report");
  expect(fetchMock.mock.calls[1][1].body).toBe(body);
  expect(JSON.parse(body)).toMatchObject({ planId: "11111111-1111-4111-8111-111111111111", plannedFor: "2099-10-11", snapshotId: suggestion.snapshotId });
  expect(fetchMock.mock.calls.every(([path]) => path === "/api/plans")).toBe(true);
  expect(sessionStorage.length).toBe(0);
});
it("declines planning unavailable pieces while leaving past-wear reporting to its separate form", () => {
  render(<PlanForm user={user} suggestion={{ ...suggestion, items: suggestion.items.map(item => ({ ...item, availability: "missing" })) }} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  expect(screen.getByText(/Some pieces are currently unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save plan" })).not.toBeInTheDocument();
});
it("does not start two creates for a click burst", async () => {
  let finish!: (response: unknown) => void;
  const fetchMock = jest.fn(() => new Promise(resolve => { finish = resolve; })); global.fetch = fetchMock as typeof fetch;
  render(<PlanForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  const save = screen.getByRole("button", { name: "Save plan" }); fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  finish({ ok: true, json: async () => ({ plannedFor: "2099-10-11" }) });
  await screen.findByRole("status");
});

it("plans an exact generated binding with an editable carried day and server-side availability", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ plannedFor: "2099-10-15" }) }); global.fetch = fetchMock as typeof fetch;
  render(<PlanForm user={user} suggestion={{ snapshotId: suggestion.snapshotId, candidateId: "child" }} initialDay={{ plannedFor: "2099-10-14", timezone: "Pacific/Kiritimati" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  expect(screen.getByLabelText("Plan for")).toHaveValue("2099-10-14");
  expect(screen.getByText(/Current piece availability is checked/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Plan for"), { target: { value: "2099-10-15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save plan" })); await screen.findByRole("status");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ snapshotId: suggestion.snapshotId, candidateId: "child", plannedFor: "2099-10-15", timezone: "Pacific/Kiritimati" });
  expect(fetchMock.mock.calls.every(([path]) => path === "/api/plans")).toBe(true);
});
it("preserves a pending command ahead of another date hint on return", async () => {
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error("lost ack")).mockResolvedValueOnce({ ok: true, json: async () => ({ plannedFor: "2099-10-14" }) }); global.fetch = fetchMock as typeof fetch;
  const view = render(<PlanForm user={user} suggestion={suggestion} initialDay={{ plannedFor: "2099-10-14", timezone: "Pacific/Kiritimati" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" })); fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  await screen.findByRole("alert"); const body = fetchMock.mock.calls[0][1].body; view.unmount();
  render(<PlanForm user={user} suggestion={suggestion} initialDay={{ plannedFor: "2099-11-01", timezone: "America/Los_Angeles" }} />);
  expect(screen.getByLabelText("Plan for")).toHaveValue("2099-10-14"); fireEvent.click(screen.getByRole("button", { name: "Retry same plan" }));
  await screen.findByRole("status"); expect(fetchMock.mock.calls[1][1].body).toBe(body);
});
it("does not acknowledge an earlier source/account after props change", async () => {
  let finish!: (response: unknown) => void; const fetchMock = jest.fn(() => new Promise(resolve => { finish = resolve; })); global.fetch = fetchMock as typeof fetch;
  const view = render(<PlanForm user={user} suggestion={suggestion} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" })); fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.rerender(<PlanForm user={{ uid: "other", getIdToken: async () => "other" } as User} suggestion={{ ...suggestion, candidateId: "new" }} />);
  await act(async () => finish({ ok: true, json: async () => ({ plannedFor: "2099-10-14" }) }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Plan this outfit" })).toBeInTheDocument();
  expect(sessionStorage.length).toBe(1); // Abandoned owner retains its identity for an explicit retry.
});
it("rejects current unavailable/source failures for inline plans and never claims success", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "plan_items_unavailable" }) });
  render(<PlanForm user={user} suggestion={{ snapshotId: suggestion.snapshotId, candidateId: "child" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" })); fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Some pieces are no longer available");
  expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(sessionStorage.length).toBe(0);
});
it("ignores malformed stored timezone instead of crashing the planning controls", () => {
  sessionStorage.setItem(`fitted:plan:${user.uid}:${suggestion.snapshotId}:${suggestion.candidateId}`, JSON.stringify({ snapshotId: suggestion.snapshotId, candidateId: suggestion.candidateId, plannedFor: "2099-10-14", timezone: "Not/AZone" }));
  render(<PlanForm user={user} suggestion={suggestion} />); fireEvent.click(screen.getByRole("button", { name: "Plan this outfit" }));
  expect(screen.getByRole("button", { name: "Save plan" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Retry same plan" })).not.toBeInTheDocument();
});
