/**
 * Dashboard — what a friend is told when a render does not come back cleanly.
 *
 * Two failures, both on the path that costs real money (every render is a paid gpt-5.4-mini call):
 *   1. A 200 whose body will not parse used to fall straight through, setting the result to `null`
 *      AND overwriting the saved copy with `null` — the dashboard returned to its blank starting
 *      screen with no message, so a completed, paid request read as "nothing happened".
 *   2. A dropped connection promised "you won't lose your place", which this code cannot guarantee:
 *      the resume depends on an envelope write that is silently allowed to fail.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: { currentUser: { uid: "u1", getIdToken: async () => "tok" } } }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", getIdToken: async () => "tok" });
    return () => {};
  },
  signOut: jest.fn(async () => {}),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
jest.mock("@/lib/sessionCookie", () => ({ clearSessionCookie: jest.fn(async () => {}) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Dashboard = (require("@/app/(app)/dashboard/page") as { default: React.ComponentType }).default;

const DASHBOARD_KEY = "fitted_dashboard_v2:u1";

const GOOD_RENDER = {
  shown: [
    {
      snapshotId: "6a4eb442443135439ac080d9",
      candidateId: "cand-1",
      displayItems: [{ itemId: "i1", name: "Blue tee", clothingType: "top" }],
      styleMove: null,
    },
  ],
  flags: { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null },
  bindable: true,
};

/** Wardrobe count for the first-use signpost, plus a configurable /api/recommend. */
function mockApi(recommend?: () => Promise<Response> | Response) {
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url);
    if (u.startsWith("/api/wardrobe")) {
      return { ok: true, json: async () => ({ items: [{ id: "i1" }, { id: "i2" }] }) } as Response;
    }
    if (u === "/api/recommend") {
      return recommend
        ? await recommend()
        : ({ ok: true, status: 200, json: async () => GOOD_RENDER } as Response);
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: jest.fn() } });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state: "prompt" as PermissionState }) },
  });
});

async function generate() {
  await userEvent.type(await screen.findByPlaceholderText(/outdoor brunch with friends/i), "class on campus");
  await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
}

describe("dashboard — an unreadable 200 is reported, not silently blanked", () => {
  const unreadable = () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    }) as unknown as Response;

  it("shows a message instead of the blank starting screen", async () => {
    mockApi(unreadable);
    render(<Dashboard />);
    await generate();

    expect(await screen.findByText(/couldn.t read the reply/i)).toBeInTheDocument();
    // The blank-state copy is what the friend saw BEFORE pressing the button; landing back on it
    // after a completed, paid request is the defect.
    expect(
      screen.queryByText(/click .*get recommendations.* to see outfit suggestions/i),
    ).not.toBeInTheDocument();
  });

  it("does not overwrite the saved render with nothing", async () => {
    // A good render first, so there IS a saved copy to destroy.
    mockApi();
    const first = render(<Dashboard />);
    await generate();
    await screen.findByText("Blue tee");
    await waitFor(() => expect(window.sessionStorage.getItem(DASHBOARD_KEY)).not.toBeNull());
    first.unmount();

    mockApi(unreadable);
    render(<Dashboard />);
    await generate();
    await screen.findByText(/couldn.t read the reply/i);

    // Pre-fix this was `{"occasion":"…","result":null}` — the friend's last good outfits, gone.
    const saved = JSON.parse(window.sessionStorage.getItem(DASHBOARD_KEY)!);
    expect(saved.result).not.toBeNull();
    expect(saved.result.shown[0].displayItems[0].name).toBe("Blue tee");
  });

  it("a normal render is unaffected", async () => {
    mockApi();
    render(<Dashboard />);
    await generate();
    expect(await screen.findByText("Blue tee")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t read the reply/i)).not.toBeInTheDocument();
  });
});

describe("dashboard — a dropped connection does not promise what it cannot keep", () => {
  it("says 'if that outfit finished', never 'you won't lose your place'", async () => {
    mockApi(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<Dashboard />);
    await generate();

    const msg = await screen.findByText(/connection dropped/i);
    // The resume depends on an envelope write that `writeJSON` is allowed to swallow, so an
    // unconditional promise is sometimes a lie — and the friend acts on it by reloading.
    expect(msg.textContent ?? "").not.toMatch(/won.t lose your place/i);
    expect(msg.textContent ?? "").toMatch(/if that outfit finished/i);
    // Still anti-guilt (§18): it describes the connection, not something the friend did wrong.
    expect(msg.textContent ?? "").not.toMatch(/you (didn|haven|failed)/i);
  });
});
