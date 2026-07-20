/**
 * §23-H63 client half: on a PARTIAL account deletion (server 502 {dataDeleted:true, authDeleted:false}
 * — Mongo erased, Firebase identity survived), the page must INFORM the user, not silently sign them
 * out. Silence would hide a retention the user asked to avoid. Drives the real AccountPage over a mocked
 * fetch/auth; the server contract (the 502 itself) is covered by accountDeleteRoute.test.ts.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `mock`-prefixed so jest's factory-hoist allows referencing them inside jest.mock() below.
const mockSignOut = jest.fn(async () => {});
const mockClearSessionCookie = jest.fn(async () => {});

jest.mock("@/lib/firebaseClient", () => ({
  auth: { currentUser: { getIdToken: async () => "tok" } },
}));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", getIdToken: async () => "tok" });
    return () => {};
  },
  signOut: mockSignOut,
}));
jest.mock("@/lib/sessionCookie", () => ({
  clearSessionCookie: mockClearSessionCookie,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const accountPage = require("@/app/(app)/account/page") as {
  default: React.ComponentType;
  PARTIAL_DELETE_MESSAGE: string;
};
const AccountPage = accountPage.default;
const { PARTIAL_DELETE_MESSAGE } = accountPage;

const LOADED_USER = {
  id: "u1",
  email: "friend@example.com",
  displayName: "Friend",
  photoURL: null,
  age: null,
  gender: null,
  appRatingScore10: 0,
  appFeedbackComment: "",
  createdAt: null,
  updatedAt: null,
};

let deleteStatus: number;
let deleteBody: Record<string, unknown>;

beforeEach(() => {
  deleteStatus = 502;
  deleteBody = { ok: false, dataDeleted: true, authDeleted: false, error: "auth_deletion_failed" };
  mockSignOut.mockClear();
  mockClearSessionCookie.mockClear();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = jest.fn(async (url: any, opts: any) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (String(url).includes("/api/account") && method === "POST") {
      return { ok: true, status: 200, json: async () => ({ user: LOADED_USER }) } as Response;
    }
    if (String(url).includes("/api/account") && method === "DELETE") {
      return { ok: deleteStatus < 400, status: deleteStatus, json: async () => deleteBody } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;

  // Both delete confirmations say "yes"; capture alert; stub navigation (jsdom can't navigate).
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(window, "alert").mockImplementation(() => {});
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
});

afterEach(() => jest.restoreAllMocks());

async function mountAndDelete() {
  render(<AccountPage />);
  // Wait for the mount-load to populate `user` so the Delete section renders.
  const btn = await screen.findByRole("button", { name: /delete my account/i });
  await userEvent.click(btn);
}

it("partial failure (502): ALERTS the honest message instead of silently signing out", async () => {
  await mountAndDelete();
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(PARTIAL_DELETE_MESSAGE));
  // The honest copy must name the surviving identity + the retry path (guards against a vague reword).
  expect(PARTIAL_DELETE_MESSAGE).toMatch(/permanently deleted/i);
  expect(PARTIAL_DELETE_MESSAGE).toMatch(/sign in again/i);
  // Still ends in the same clean sign-out as success (not stranded on a dataless session).
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  expect(mockClearSessionCookie).toHaveBeenCalled();
});

it("full success (200): does NOT alert — signs out silently", async () => {
  deleteStatus = 200;
  deleteBody = { ok: true };
  await mountAndDelete();
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  expect(window.alert).not.toHaveBeenCalled();
});
