/**
 * DEFECTS-H88 (client half) — AuthGate must check the sync outcome instead of admitting blindly.
 *
 * Pre-fix, AuthGate fired `/api/auth/sync` for its side effect and never read `res.ok`, so a 500/503
 * there still admitted the user into a fully-rendered app in which every later call failed — a
 * database outage presenting as a mysteriously broken (or "logged-out") app. Pinned here: a failed
 * sync shows an honest "temporary problem, try again" screen with a working retry; a clean sync
 * still admits; a 401 (revoked token) signs out rather than looping.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signOutMock = jest.fn(async (_auth?: unknown) => {});
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", getIdToken: async () => "tok", displayName: null, photoURL: null });
    return () => {};
  },
  signOut: (auth?: unknown) => signOutMock(auth),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/sessionCookie", () => ({ ensureSessionCookie: jest.fn(async () => {}) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AuthGate = (require("@/app/(app)/AuthGate") as { default: React.ComponentType<{ children: React.ReactNode }> }).default;

function mockSync(responses: Array<{ ok: boolean; status: number } | "network-error">) {
  let call = 0;
  global.fetch = jest.fn(async () => {
    const r = responses[Math.min(call++, responses.length - 1)];
    if (r === "network-error") throw new TypeError("Failed to fetch");
    return { ok: r.ok, status: r.status, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => jest.clearAllMocks());

describe("AuthGate — a database/server fault gates with an honest retry, never a broken app", () => {
  it("a 503 sync shows the trouble screen (children NOT rendered), and Try again admits once healthy", async () => {
    mockSync([{ ok: false, status: 503 }, { ok: true, status: 200 }]);
    render(
      <AuthGate>
        <div>app content</div>
      </AuthGate>,
    );

    // Pre-fix: "app content" rendered here despite the 503 — the H88 admission defect.
    expect(await screen.findByText(/trouble reaching your closet/i)).toBeInTheDocument();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
    // Honest, anti-guilt copy: temporary and not the friend's login.
    expect(screen.getByText(/temporary/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("app content")).toBeInTheDocument();
    expect(screen.queryByText(/trouble reaching your closet/i)).not.toBeInTheDocument();
  });

  it("a network failure on sync gates the same way (the server may be unreachable entirely)", async () => {
    mockSync(["network-error"]);
    render(
      <AuthGate>
        <div>app content</div>
      </AuthGate>,
    );
    expect(await screen.findByText(/trouble reaching your closet/i)).toBeInTheDocument();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });

  it("a clean sync still admits (the gate must not over-block the healthy path)", async () => {
    mockSync([{ ok: true, status: 200 }]);
    render(
      <AuthGate>
        <div>app content</div>
      </AuthGate>,
    );
    expect(await screen.findByText("app content")).toBeInTheDocument();
  });

  it("a 401 sync (revoked token) signs out instead of showing the retry screen or looping", async () => {
    mockSync([{ ok: false, status: 401 }]);
    render(
      <AuthGate>
        <div>app content</div>
      </AuthGate>,
    );
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
    expect(screen.queryByText(/trouble reaching your closet/i)).not.toBeInTheDocument();
  });
});
