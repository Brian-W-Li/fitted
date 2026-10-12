import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "firebase/auth";
let mockAuthCallback: (user: User | null) => void;
let mockUser: User;
let mockParams = "";
jest.mock("@/lib/firebaseClient", () => ({ auth: { get currentUser() { return mockUser; } } }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: typeof mockAuthCallback) => { mockAuthCallback = callback; callback(mockUser); return () => {}; },
  signOut: jest.fn(async () => {}),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => new URLSearchParams(mockParams) }));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn(async () => {}) }));
import { clearSessionCookie } from "@/lib/sessionCookie";
import Dashboard from "@/app/(app)/dashboard/page";
const ROOT_ID = "650000000000000000000001";
const RENDER = { shown: [{ snapshotId: ROOT_ID, candidateId: "c0", displayItems: [{ itemId: "i1", name: "Green shirt", clothingType: "top" }], styleMove: null }],
  flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null }, bindable: true };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body } as Response);
const user = (uid: string) => ({ uid, getIdToken: async () => uid } as User);
function serve(recommend: (body: Record<string, unknown>) => Promise<Response> | Response = () => response(RENDER)) {
  const bodies: Record<string, unknown>[] = [];
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url) === "/api/recommend") { const body = JSON.parse(String(init?.body)); bodies.push(body); return recommend(body); }
    if (String(url) === "/api/wardrobe") return response({ items: [{ id: "i1" }] });
    if (String(url) === "/api/interactions") return response({ interactions: [] });
    return response({}, 404);
  }) as typeof fetch;
  return bodies;
}
async function fillWeather() {
  fireEvent.change(await screen.findByLabelText("Temperature"), { target: { value: "cold" } });
  fireEvent.change(screen.getByLabelText("Rain"), { target: { value: "rain" } });
  fireEvent.change(screen.getByLabelText("Wind"), { target: { value: "windy" } });
  fireEvent.change(screen.getByPlaceholderText(/outdoor brunch/i), { target: { value: "Class tomorrow" } });
}
const manual = { weather: "cold", weatherRaw: "Cold; rain expected; windy", weatherSource: "manual", weatherSignals: { rain: true, wind: true } };
beforeEach(() => {
  sessionStorage.clear(); mockUser = user("u1"); mockParams = "";
  (clearSessionCookie as jest.Mock).mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: jest.fn() } });
});

it.each(["", "rescue=650000000000000000000002&name=Green%20shirt"])("sends expected conditions without location for daily/rescue %s and persists them before fetch", async params => {
  mockParams = params;
  const bodies = serve(body => {
    const pending = JSON.parse(sessionStorage.getItem("fitted_pending_render:u1")!);
    expect(pending.lensSummary).toMatchObject(manual);
    expect(pending.requestId).toBe(body.requestId);
    return response(RENDER);
  });
  render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" }));
  await screen.findAllByText("Green shirt");
  expect(bodies[0]).toMatchObject({ ...manual, occasion: "Class tomorrow" });
  expect(bodies[0]).not.toHaveProperty("lat"); expect(bodies[0]).not.toHaveProperty("lon");
  if (params) expect(bodies[0].forcedItemId).toBe("650000000000000000000002");
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("keeps an automatic request optional and explains manual precedence after a location grant", async () => {
  const bodies = serve();
  (navigator.geolocation.getCurrentPosition as jest.Mock).mockImplementation(ok => ok({ coords: { latitude: 34, longitude: -119 } }));
  render(<Dashboard />);
  expect(screen.queryByLabelText("Rain")).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Use my location" }));
  fireEvent.change(screen.getByPlaceholderText(/outdoor brunch/i), { target: { value: "Class" } });
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText("Green shirt");
  expect(bodies[0]).toMatchObject({ lat: 34, lon: -119 }); expect(bodies[0]).not.toHaveProperty("weatherSource");
  await fillWeather();
  expect(screen.getByText(/Your expected weather will be used, including when location is shared/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText("Green shirt");
  expect(bodies[1]).toMatchObject(manual);
});

it("freezes manual values before token acquisition and restores the same pending command after reload", async () => {
  const firstBodies = serve(() => response({}, 500));
  const view = render(<Dashboard />); await fillWeather();
  let resolveToken!: (token: string) => void;
  const token = new Promise<string>(resolve => { resolveToken = resolve; });
  mockUser.getIdToken = jest.fn(() => token);
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" }));
  const original = JSON.parse(sessionStorage.getItem("fitted_pending_render:u1")!);
  expect(original.lensSummary).toMatchObject(manual); expect(firstBodies).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
  await act(async () => resolveToken("u1")); await screen.findAllByText(/went wrong on our side/);
  expect(firstBodies[0]).toMatchObject(manual);
  view.unmount(); mockUser = user("u1");
  const resumed = serve(); render(<Dashboard />);
  await screen.findAllByText("Green shirt");
  expect(resumed[0]).toEqual(firstBodies[0]);
  expect(screen.getByLabelText("Temperature")).toHaveValue("cold"); expect(screen.getByLabelText("Rain")).toHaveValue("rain");
  expect(screen.getByLabelText("Wind")).toHaveValue("windy");
  expect(sessionStorage.getItem("fitted_pending_render:u1")).toBeNull();
});

it("rerolls using the saved parent and retains original context after weather and occasion edits, including reload", async () => {
  let call = 0;
  const bodies = serve(() => ++call === 1 ? response(RENDER) : response({}, 500));
  const view = render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText("Green shirt");
  fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
  fireEvent.change(screen.getByPlaceholderText(/outdoor brunch/i), { target: { value: "Beach" } });
  await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  const modal = screen.getByText(/lock the pieces you want to keep/i).closest(".fixed") as HTMLElement;
  await userEvent.click(within(modal).getByRole("button", { name: "Regenerate" })); await screen.findAllByText(/went wrong on our side/);
  expect(bodies[1]).toEqual({ requestId: expect.any(String), parentSnapshotId: ROOT_ID, controls: { lockedItemIds: [], dislikedItemIds: [] } });
  expect(JSON.parse(sessionStorage.getItem("fitted_pending_render:u1")!).lensSummary).toMatchObject({ ...manual, occasion: "Class tomorrow" });
  view.unmount(); const resumed = serve(); render(<Dashboard />);
  await waitFor(() => expect(resumed).toHaveLength(1));
  expect(resumed[0]).toEqual(bodies[1]);
  expect(screen.getByLabelText("Temperature")).toHaveValue("cold");
  expect(screen.getByPlaceholderText(/outdoor brunch/i)).toHaveValue("Class tomorrow");
});

it("clears a prior account's result and manual controls when the next account has no saved state", async () => {
  serve(); render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText("Green shirt");
  await act(async () => { mockUser = user("u2"); mockAuthCallback(mockUser); });
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Temperature")).toHaveValue("");
  expect(screen.getByPlaceholderText(/outdoor brunch/i)).toHaveValue("");
  expect(sessionStorage.getItem("fitted_dashboard_v2:u2")).toBeNull();
});

it("discards a delayed prior-account response without clearing the new account's pending command", async () => {
  let finishA!: (value: Response) => void;
  const delayedA = new Promise<Response>(resolve => { finishA = resolve; });
  let call = 0;
  const bodies = serve(() => ++call === 1 ? delayedA : response({}, 500));
  render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await waitFor(() => expect(bodies).toHaveLength(1));
  await act(async () => { mockUser = user("u2"); mockAuthCallback(mockUser); });
  fireEvent.change(screen.getByPlaceholderText(/outdoor brunch/i), { target: { value: "Dinner" } });
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText(/went wrong on our side/);
  const pendingB = sessionStorage.getItem("fitted_pending_render:u2");
  await act(async () => finishA(response(RENDER)));
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText(/outdoor brunch/i)).toHaveValue("Dinner");
  expect(sessionStorage.getItem("fitted_pending_render:u2")).toBe(pendingB);
  expect(sessionStorage.getItem("fitted_pending_render:u1")).not.toBeNull();
  expect(sessionStorage.getItem("fitted_dashboard_v2:u2")).toBeNull();
});


it("ignores an old A response after A → B → A while a newer A command remains pending", async () => {
  let finishOldA!: (value: Response) => void;
  let finishNewA!: (value: Response) => void;
  const oldA = new Promise<Response>(resolve => { finishOldA = resolve; });
  const newA = new Promise<Response>(resolve => { finishNewA = resolve; });
  let call = 0;
  const bodies = serve(() => ++call === 1 ? oldA : newA);
  render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await waitFor(() => expect(bodies).toHaveLength(1));
  await act(async () => { mockUser = user("u2"); mockAuthCallback(mockUser); });
  // Simulate explicit discard of A's old action before returning, so the next A render is new.
  sessionStorage.removeItem("fitted_pending_render:u1");
  await act(async () => { mockUser = user("u1"); mockAuthCallback(mockUser); });
  fireEvent.change(screen.getByPlaceholderText(/outdoor brunch/i), { target: { value: "A new event" } });
  fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await waitFor(() => expect(bodies).toHaveLength(2));
  const newPending = sessionStorage.getItem("fitted_pending_render:u1");
  await act(async () => finishOldA(response(RENDER)));
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
  expect(screen.getByLabelText("Temperature")).toHaveValue("hot");
  expect(sessionStorage.getItem("fitted_pending_render:u1")).toBe(newPending);
  expect(sessionStorage.getItem("fitted_dashboard_v2:u1")).toBeNull();
  await act(async () => finishNewA(response({ ...RENDER, shown: [{ ...RENDER.shown[0], displayItems: [{ itemId: "i2", name: "New shirt" }] }] })));
  expect(screen.getByText("New shirt")).toBeInTheDocument();
});

it("does not send a prior account command when its token arrives after switching accounts", async () => {
  const bodies = serve(); render(<Dashboard />); await fillWeather();
  let resolveToken!: (token: string) => void;
  const token = new Promise<string>(resolve => { resolveToken = resolve; });
  mockUser.getIdToken = jest.fn(() => token);
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" }));
  expect(sessionStorage.getItem("fitted_pending_render:u1")).not.toBeNull();
  await act(async () => { mockUser = user("u2"); mockAuthCallback(mockUser); });
  await act(async () => resolveToken("u1"));
  expect(bodies).toHaveLength(0);
  expect(screen.getByLabelText("Temperature")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Get Recommendations" })).toBeEnabled();
});


it("invalidates a pending render before asynchronous logout cleanup so it cannot recreate cleared storage", async () => {
  let finishRender!: (value: Response) => void;
  const delayed = new Promise<Response>(resolve => { finishRender = resolve; });
  let finishCookie!: () => void;
  const cookie = new Promise<void>(resolve => { finishCookie = resolve; });
  (clearSessionCookie as jest.Mock).mockReturnValue(cookie);
  const bodies = serve(() => delayed);
  render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await waitFor(() => expect(bodies).toHaveLength(1));
  await userEvent.click(screen.getByRole("button", { name: "Log Out" }));
  expect(sessionStorage.getItem("fitted_pending_render:u1")).toBeNull();
  await act(async () => finishRender(response(RENDER)));
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("fitted_dashboard_v2:u1")).toBeNull();
  await act(async () => finishCookie());
  expect(sessionStorage.getItem("fitted_pending_render:u1")).toBeNull();
  expect(sessionStorage.getItem("fitted_dashboard_v2:u1")).toBeNull();
});


it("cannot restore cleared dashboard storage by rating an old card during asynchronous logout", async () => {
  let finishCookie!: () => void;
  const cookie = new Promise<void>(resolve => { finishCookie = resolve; });
  (clearSessionCookie as jest.Mock).mockReturnValue(cookie);
  serve(); render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" })); await screen.findAllByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Log Out" }));
  await userEvent.click(screen.getByRole("button", { name: "Like" }));
  expect(sessionStorage.getItem("fitted_dashboard_v2:u1")).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls.filter(([path, init]) => path === "/api/interactions" && init?.method === "POST")).toHaveLength(0);
  await act(async () => finishCookie());
});

it("keeps layer-choice explanation on result reload", async () => {
  const note = "An optional removable layer is included. Rain and wind protection are unknown; check the garment and conditions before relying on it.";
  serve(() => response({ ...RENDER, layerChoice: { status: "offered", note } }));
  const view = render(<Dashboard />); await fillWeather();
  await userEvent.click(screen.getByRole("button", { name: "Get Recommendations" }));
  expect(await screen.findByText(note)).toBeInTheDocument();
  view.unmount(); const bodies = serve(); render(<Dashboard />);
  expect(await screen.findByText(note)).toBeInTheDocument(); expect(bodies).toHaveLength(0);
});
