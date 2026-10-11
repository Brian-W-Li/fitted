import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";

let mockAuthCallback: (user: User | null) => void;
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: User | null) => void) => {
    mockAuthCallback = callback;
    callback({ uid: "u1", getIdToken: async () => "token-u1" } as User);
    return () => {};
  },
}));
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("itemId=650000000000000000000001") }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MemoryPage = (require("@/app/(app)/memory/page") as { default: React.ComponentType }).default;

const report = (id: string) => ({
  experienceId: id, lifecycle: "active", currentRevision: 1, sourceAvailable: false, source: null, items: [],
  state: { occurredOn: "2026-10-09", timezone: "UTC", context: { rawOccasion: "Class", source: "user", confirmed: true }, outcome: "unknown" },
});
function response(body: unknown) { return { ok: true, json: async () => body } as Response; }
beforeEach(() => {
  localStorage.clear();
  let sequence = 0;
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true,
    value: jest.fn(() => `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`) });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("keeps a sparse recall page honest and follows its continuation", async () => {
  global.fetch = jest.fn(async (path: string) => {
    if (path.startsWith("/api/wardrobe")) return response({ items: [] });
    if (path.includes("/suggestions")) return response({ suggestions: [], nextCursor: null });
    if (path.includes("lifecycle=retracted")) return response({ experiences: [], nextCursor: null });
    return path.includes("cursor=older")
      ? response({ experiences: [report("older-report")], nextCursor: null })
      : response({ experiences: [], nextCursor: "older" });
  }) as typeof fetch;
  render(<MemoryPage />);
  expect(await screen.findByText("No matches on this page. Continue to older reports.")).toBeInTheDocument();
  expect(screen.queryByText("No reported wears for this selection yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More reported wears" }));
  expect(await screen.findByText(/Worn 2026-10-09/)).toBeInTheDocument();
});

it("drops the prior account's visible records when identity changes", async () => {
  let releaseSecond!: (value: Response) => void;
  const second = new Promise<Response>(resolve => { releaseSecond = resolve; });
  global.fetch = jest.fn((path: string, init: RequestInit) => {
    const owner = String((init.headers as Record<string, string>).Authorization).includes("u2") ? "u2" : "u1";
    if (path.startsWith("/api/wardrobe")) return Promise.resolve(response({ items: [] }));
    if (path.includes("/suggestions")) return Promise.resolve(response({ suggestions: [], nextCursor: null }));
    if (path.includes("lifecycle=retracted")) return Promise.resolve(response({ experiences: [], nextCursor: null }));
    return owner === "u1" ? Promise.resolve(response({ experiences: [report("first-account")], nextCursor: null })) : second;
  }) as typeof fetch;
  render(<MemoryPage />);
  expect(await screen.findByText(/Worn 2026-10-09/)).toBeInTheDocument();
  act(() => mockAuthCallback({ uid: "u2", getIdToken: async () => "token-u2" } as User));
  expect(screen.queryByText(/Worn 2026-10-09/)).not.toBeInTheDocument();
  await act(async () => { releaseSecond(response({ experiences: [report("second-account")], nextCursor: null })); });
  await waitFor(() => expect(screen.getByText(/Worn 2026-10-09/)).toBeInTheDocument());
  expect((global.fetch as jest.Mock).mock.calls.some(([, init]) => String(init?.headers?.Authorization).includes("token-u2"))).toBe(true);
});

it("reports a failed continuation and does not issue two requests for one click burst", async () => {
  let rejectOlder!: (error: Error) => void;
  const older = new Promise<Response>((_resolve, reject) => { rejectOlder = reject; });
  let olderRequests = 0;
  global.fetch = jest.fn((path: string) => {
    if (path.startsWith("/api/wardrobe")) return Promise.resolve(response({ items: [] }));
    if (path.includes("/suggestions")) return Promise.resolve(response({ suggestions: [], nextCursor: null }));
    if (path.includes("lifecycle=retracted")) return Promise.resolve(response({ experiences: [], nextCursor: null }));
    if (path.includes("cursor=older")) return ++olderRequests === 1 ? older : Promise.resolve(response({ experiences: [report("recovered")], nextCursor: null }));
    return Promise.resolve(response({ experiences: [], nextCursor: "older" }));
  }) as typeof fetch;
  render(<MemoryPage />);
  const more = await screen.findByRole("button", { name: "More reported wears" });
  fireEvent.click(more);
  fireEvent.click(more);
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(([path]) => String(path).includes("cursor=older"))).toHaveLength(1));
  await act(async () => rejectOlder(new Error("temporary outage")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load older results: temporary outage");
  expect(screen.getByRole("button", { name: "More reported wears" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "More reported wears" }));
  expect(await screen.findByText(/Worn 2026-10-09/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ignores an older-page response after the situation filter changes", async () => {
  let releaseOlder!: (value: Response) => void;
  const older = new Promise<Response>(resolve => { releaseOlder = resolve; });
  global.fetch = jest.fn((path: string) => {
    if (path.startsWith("/api/wardrobe")) return Promise.resolve(response({ items: [] }));
    if (path.includes("/suggestions")) return Promise.resolve(response({ suggestions: [], nextCursor: null }));
    if (path.includes("lifecycle=retracted")) return Promise.resolve(response({ experiences: [], nextCursor: null }));
    if (path.includes("cursor=older")) return older;
    return Promise.resolve(response({ experiences: [], nextCursor: path.includes("context=Dinner") ? null : "older" }));
  }) as typeof fetch;
  render(<MemoryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "More reported wears" }));
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([path]) => String(path).includes("cursor=older"))).toBe(true));
  fireEvent.change(screen.getByRole("textbox", { name: "Filter actual situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(await screen.findByText("No reported wears for this selection yet.")).toBeInTheDocument();
  await act(async () => { releaseOlder(response({ experiences: [report("stale")], nextCursor: null })); });
  expect(screen.queryByText(/Worn 2026-10-09/)).not.toBeInTheDocument();
});


it.each([409, 503])("recovers retraction appropriately after HTTP %s", async status => {
  let revision = 1;
  const commands: Array<{ operationId: string; expectedPreviousRevision: number }> = [];
  global.fetch = jest.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/wardrobe")) return response({ items: [] });
    if (path.includes("/suggestions")) return response({ suggestions: [], nextCursor: null });
    if (path.includes("lifecycle=retracted")) return response({ experiences: [], nextCursor: null });
    if (path.endsWith("/retract")) {
      commands.push(JSON.parse(String(init?.body)));
      if (commands.length === 1) {
        revision = 2;
        return { ok: false, status, json: async () => ({ error: status === 409 ? "revision_conflict" : "temporary failure" }) } as Response;
      }
      return response({ acknowledgedRevision: 3 });
    }
    return response({ experiences: [{ ...report("wear-1"), currentRevision: revision }], nextCursor: null });
  }) as typeof fetch;
  render(<MemoryPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Retract report" }));
  if (status === 409) {
    await screen.findByText(/Retraction was not accepted/);
    await waitFor(() => expect(localStorage.length).toBe(0));
  } else await screen.findByRole("alert");
  fireEvent.click(await screen.findByRole("button", { name: "Retract report" }));
  await waitFor(() => expect(commands).toHaveLength(2));
  if (status === 409) {
    expect(commands[1].expectedPreviousRevision).toBe(2);
    expect(commands[1].operationId).not.toBe(commands[0].operationId);
  } else expect(commands[1]).toEqual(commands[0]);
});
