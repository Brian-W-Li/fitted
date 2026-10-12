import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
let mockAuthCallback: (user: User | null) => void;
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: (_: unknown, callback: typeof mockAuthCallback) => {
  mockAuthCallback = callback; callback({ uid: "u1", getIdToken: async () => "u1" } as User); return () => {};
} }));
import PlanningPage from "@/app/(app)/plans/page";
const plan = { planId: "11111111-1111-4111-8111-111111111111", revision: 1, plannedFor: "2001-10-11", timezone: "UTC", suggestion: {
  snapshotId: "650000000000000000000001", candidateId: "c0", suggestionContext: "Dinner", items: [{ itemId: "650000000000000000000002", name: "Green shirt", availability: "unavailable", changed: false, imageUrl: "mongo:650000000000000000000009" }],
} };
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body } as Response);
beforeEach(() => { sessionStorage.clear(); Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "22222222-2222-4222-8222-222222222222" }); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
it("shows past plans honestly, labels availability and drops removed source content on tab return", async () => {
  const fetchMock = jest.fn(async () => response({ plans: [plan] })); global.fetch = fetchMock as typeof fetch;
  render(<PlanningPage />);
  expect(await screen.findByText("Green shirt")).toBeInTheDocument();
  expect(screen.getByAltText("Green shirt")).toHaveAttribute("src", "/api/images/650000000000000000000009");
  expect(screen.getByText(/day has passed/)).toBeInTheDocument(); expect(screen.getByText("currently unavailable")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open proposal / report actual wear" })).toHaveAttribute("href", "/memory/proposal?snapshotId=650000000000000000000001&candidateId=c0&plannedFor=2001-10-11&timezone=UTC");
  fetchMock.mockImplementation(async () => response({ plans: [{ ...plan, suggestion: null }] }));
  fireEvent.focus(window);
  expect(await screen.findByText(/This proposal is no longer available/)).toBeInTheDocument();
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.queryByAltText("Green shirt")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open proposal / report actual wear" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove plan" })).toBeInTheDocument();
});
it("reuses a reschedule request after lost acknowledgement, then refreshes the list", async () => {
  let edits = 0; const bodies: string[] = [];
  global.fetch = jest.fn(async (_path: string, init: RequestInit) => {
    if (init.method === "PATCH") { bodies.push(init.body as string); if (++edits === 1) throw new Error("ack lost"); return response({}); }
    return response({ plans: [{ ...plan, revision: edits >= 2 ? 2 : 1, plannedFor: edits >= 2 ? "2099-10-12" : plan.plannedFor }] });
  }) as typeof fetch;
  render(<PlanningPage />); await screen.findByText("Green shirt");
  fireEvent.change(screen.getByLabelText("Change planned day"), { target: { value: "2099-10-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new date" }));
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
  expect(await screen.findByRole("heading", { name: "Planned for 2099-10-12" })).toBeInTheDocument();
  expect(bodies[1]).toBe(bodies[0]); expect(JSON.parse(bodies[0])).toMatchObject({ expectedRevision: 1, plannedFor: "2099-10-12" });
});
it("removes a plan with no wear request", async () => {
  let removed = false;
  const fetchMock = jest.fn(async (_path: string, init: RequestInit) => {
    if (init.method === "DELETE") { removed = true; return response({ removed: true }); }
    return response({ plans: removed ? [] : [plan] });
  }); global.fetch = fetchMock as typeof fetch;
  render(<PlanningPage />); await screen.findByText("Green shirt");
  fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));
  expect(await screen.findByText(/No planned outfits yet/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([path]) => !path.includes("experiences"))).toBe(true);
});
it("shows failed retrieval instead of a false empty list, and ignores a previous account's late result", async () => {
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { finish = resolve; });
  global.fetch = jest.fn(async (_path: string, init: RequestInit) => (init.headers as Record<string, string>).Authorization.includes("u1") ? delayed : response({}, false, 503)) as typeof fetch;
  render(<PlanningPage />); await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  act(() => mockAuthCallback({ uid: "u2", getIdToken: async () => "u2" } as User));
  await screen.findByRole("alert"); await act(async () => finish(response({ plans: [plan] })));
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument(); expect(screen.queryByText(/No planned outfits yet/)).not.toBeInTheDocument();
});

it("keeps readable garment labels when photos are absent, invalid or fail to load", async () => {
  const items = [plan.suggestion.items[0], { ...plan.suggestion.items[0], itemId: "no-photo", name: "Plain trousers", imageUrl: null },
    { ...plan.suggestion.items[0], itemId: "unsafe-photo", name: "White shoes", imageUrl: "javascript:alert(1)" }];
  global.fetch = jest.fn(async () => response({ plans: [{ ...plan, suggestion: { ...plan.suggestion, items } }] })) as typeof fetch;
  render(<PlanningPage />); const image = await screen.findByAltText("Green shirt");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  fireEvent.error(image); expect(image).not.toBeVisible();
  for (const name of ["Green shirt", "Plain trousers", "White shoes"]) expect(screen.getByText(name)).toBeVisible();
});
