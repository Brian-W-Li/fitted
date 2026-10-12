import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockAuthCallback: (user: unknown) => void;
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    mockAuthCallback = callback;
    callback({ uid: "owner", getIdToken: async () => "token" });
    return () => {};
  },
}));
import WardrobePage from "@/app/(app)/wardrobe/page";

const item = { id: "shirt", name: "Green shirt", category: "top", clothingType: "top", warmth: 2, colors: [], seasons: [], occasions: [] };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const failed = (body: unknown) => ({ ok: false, status: 503, json: async () => body }) as Response;

beforeEach(() => { window.confirm = jest.fn(() => true); });

it("replaces stale garments after a partial clear and allows cleanup retry with an empty list", async () => {
  let reads = 0;
  let clears = 0;
  global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/wardrobe" && !options?.method) {
      reads++;
      return ok({ items: reads === 1 ? [item] : [] });
    }
    if (url === "/api/wardrobe/clear") {
      clears++;
      return clears === 1
        ? failed({ ok: false, error: "Wardrobe deletion completed, but photo cleanup is incomplete. Reload and retry.",
          deletedCount: 1, itemsCleared: true, cleanupComplete: false })
        : ok({ ok: true, deletedCount: 0, itemsCleared: true, cleanupComplete: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await screen.findByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
  expect(await screen.findByText(/Wardrobe deletion completed, but photo cleanup is incomplete/)).toBeInTheDocument();
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "Retry delete / cleanup" });
  expect(retry).toBeEnabled();
  await userEvent.click(retry);
  await waitFor(() => expect(clears).toBe(2));
  expect(screen.getByRole("button", { name: "Delete all" })).toBeEnabled();
});

it("reconciles an unknown transport result before showing the remaining closet", async () => {
  let reads = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/wardrobe") { reads++; return ok({ items: reads === 1 ? [item] : [] }); }
    if (url === "/api/wardrobe/clear") throw new Error("connection lost");
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<WardrobePage />);
    await screen.findByText("Green shirt");
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(await screen.findByText(/deletion result could not be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry delete / cleanup" })).toBeEnabled();
  } finally { consoleSpy.mockRestore(); }
});

it("shows only server-confirmed survivors after a delete fails before completion", async () => {
  const remaining = { ...item, id: "jacket", name: "Blue jacket" };
  let reads = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/wardrobe") { reads++; return ok({ items: reads === 1 ? [item, remaining] : [remaining] }); }
    if (url === "/api/wardrobe/clear") return failed({ ok: false, itemsCleared: false,
      cleanupComplete: false, error: "Wardrobe deletion may be incomplete. Reload the closet, then retry." });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await screen.findByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
  expect(await screen.findByText(/Wardrobe deletion may be incomplete/)).toBeInTheDocument();
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.getByText("Blue jacket")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry delete / cleanup" })).toBeEnabled();
});

it("keeps a garment added after the acknowledged delete when the success reload finds it", async () => {
  const later = { ...item, id: "later", name: "Later jacket" };
  let reads = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/wardrobe") { reads++; return ok({ items: reads === 1 ? [item] : [later] }); }
    if (url === "/api/wardrobe/clear") return ok({ ok: true, deletedCount: 1, itemsCleared: true, cleanupComplete: true });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await screen.findByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
  expect(await screen.findByText("Later jacket")).toBeInTheDocument();
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(reads).toBe(2);
});

it("reports successful deletion with an unknown current closet if its reload fails", async () => {
  let reads = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/wardrobe") { reads++; return reads === 1 ? ok({ items: [item] }) : failed({ error: "GET failed" }); }
    if (url === "/api/wardrobe/clear") return ok({ ok: true, deletedCount: 1, itemsCleared: true, cleanupComplete: true });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await screen.findByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
  expect(await screen.findByText(/Wardrobe deletion completed, but the current closet could not be reloaded/)).toBeInTheDocument();
  expect(screen.queryByText("Green shirt")).not.toBeInTheDocument();
  expect(screen.getByText(/Current wardrobe could not be confirmed/)).toBeInTheDocument();
});

it("does not let an old owner's delayed clear response erase the new owner's list", async () => {
  const other = { ...item, id: "other", name: "Other owner's jacket" };
  let finishClear: (response: Response) => void = () => {};
  global.fetch = jest.fn((url: string, options?: RequestInit) => {
    if (url === "/api/wardrobe" && !options?.method) {
      return Promise.resolve(ok({ items: options?.headers && (options.headers as Record<string, string>).Authorization === "Bearer new-token"
        ? [other] : [item] }));
    }
    if (url === "/api/wardrobe/clear") return new Promise<Response>(resolve => { finishClear = resolve; });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await screen.findByText("Green shirt");
  await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
  act(() => mockAuthCallback({ uid: "new-owner", getIdToken: async () => "new-token" }));
  await screen.findByText("Other owner's jacket");
  await act(async () => finishClear(ok({ ok: true, deletedCount: 1, itemsCleared: true, cleanupComplete: true })));
  expect(screen.getByText("Other owner's jacket")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete all" })).toBeEnabled();
});

it.each(["resolve", "reject"] as const)("ignores an old owner's %s after transport failure and account switch", async outcome => {
  const other = { ...item, id: "other", name: "Other owner's jacket" };
  let tokenCalls = 0;
  let settleToken: (value?: string) => void = () => {};
  const oldOwner = {
    uid: "owner",
    getIdToken: () => {
      tokenCalls++;
      if (tokenCalls <= 2) return Promise.resolve("token");
      return new Promise<string>((resolve, reject) => {
        settleToken = value => outcome === "resolve" ? resolve(value ?? "token") : reject(new Error("token failed"));
      });
    },
  };
  global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/wardrobe" && !options?.method) {
      return ok({ items: (options?.headers as Record<string, string>).Authorization === "Bearer new-token" ? [other] : [item] });
    }
    if (url === "/api/wardrobe/clear") throw new Error("connection lost");
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<WardrobePage />);
    act(() => mockAuthCallback(oldOwner));
    await screen.findByText("Green shirt");
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(tokenCalls).toBe(3));
    act(() => mockAuthCallback({ uid: "new-owner", getIdToken: async () => "new-token" }));
    await screen.findByText("Other owner's jacket");
    await act(async () => { settleToken("token"); });
    expect(screen.getByText("Other owner's jacket")).toBeInTheDocument();
    expect(screen.queryByText(/current closet could not be confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading wardrobe/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete all" })).toBeEnabled();
  } finally { consoleSpy.mockRestore(); }
});
