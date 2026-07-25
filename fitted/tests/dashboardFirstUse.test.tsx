/**
 * Dashboard FIRST-USE surface — the two friend-facing gaps a brand-new signup hits before they have
 * anything to generate from (friend-first-use hardening pass, fixes #5 + #6):
 *
 *   #5 location priming — the native permission prompt must NOT fire on mount with no in-app "why".
 *   #6 empty-closet signpost — a 0-item closet gets a proactive "add your clothes" CTA, and the
 *      rescue teaser (which presupposes they own a piece they can't style) is suppressed.
 *
 * Drives the REAL DashboardInner over a mocked fetch/auth/router, so a regression in the render
 * conditions is caught here rather than by a friend.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
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

/** Serve GET /api/wardrobe with `count` items; everything else 404s (nothing else runs on mount). */
function mockWardrobe(count: number) {
  global.fetch = jest.fn(async (url: unknown) => {
    if (String(url).startsWith("/api/wardrobe")) {
      return {
        ok: true,
        json: async () => ({ items: Array.from({ length: count }, (_, i) => ({ id: `i${i}` })) }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

const getCurrentPosition = jest.fn();

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: `clear` wipes call records but KEEPS implementations, so a
  // `getCurrentPosition.mockImplementation(...)` set by one test leaked into every later test in the
  // file and the suite's result depended on describe order.
  jest.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  // Default: the browser would still prompt, so nothing auto-resumes.
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state: "prompt" as PermissionState }) },
  });
});

/** Permissions API answer for geolocation; `undefined` removes the API entirely (older Safari). */
function mockPermissions(state?: PermissionState) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: state === undefined ? undefined : { query: async () => ({ state }) },
  });
}

describe("dashboard — an EXISTING grant resumes without re-asking (#5)", () => {
  it("resumes silently when the browser already reports 'granted'", async () => {
    // Priming the ask must not cost the weather signal on every later visit. An already-granted
    // permission shows NO prompt, so calling getCurrentPosition here is not a cold ask.
    mockWardrobe(5);
    mockPermissions("granted");
    getCurrentPosition.mockImplementation((okCb: (p: unknown) => void) =>
      okCb({ coords: { latitude: 34.4, longitude: -119.8 } }),
    );
    render(<Dashboard />);
    expect(await screen.findByText(/using your location for local weather/i)).toBeInTheDocument();
  });

  it("does NOT resume when the browser would still prompt", async () => {
    mockWardrobe(5);
    mockPermissions("prompt");
    render(<Dashboard />);
    expect(await screen.findByRole("button", { name: /use my location/i })).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("falls back to the manual button when the Permissions API is absent", async () => {
    mockWardrobe(5);
    mockPermissions(undefined);
    render(<Dashboard />);
    expect(await screen.findByRole("button", { name: /use my location/i })).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});

describe("dashboard — location is primed, not sprung (#5)", () => {
  it("does NOT call getCurrentPosition on mount", async () => {
    mockWardrobe(5);
    mockPermissions("prompt");
    render(<Dashboard />);
    // The in-app explanation stands in place of a cold native prompt.
    expect(await screen.findByRole("button", { name: /use my location/i })).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("asks the browser only when the friend taps, and reports the grant", async () => {
    mockWardrobe(5);
    getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 34.4, longitude: -119.8 } }),
    );
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /use my location/i }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/using your location for local weather/i)).toBeInTheDocument();
  });

  it("degrades gracefully on denial — says what is lost and how to compensate, no dead end", async () => {
    mockWardrobe(5);
    getCurrentPosition.mockImplementation((_ok: unknown, fail: () => void) => fail());
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /use my location/i }));
    expect(await screen.findByText(/outfits are picked without today's weather/i)).toBeInTheDocument();
    // Generate stays available — declining location must never block the product.
    expect(screen.getByRole("button", { name: /get recommendations/i })).toBeEnabled();
    // And the decision is reversible.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("passes a timeout so an unanswered prompt can't strand the button on 'Waiting…'", async () => {
    // Some mobile browsers invoke NEITHER callback when the native prompt is swiped away. The
    // timeout guarantees the error arm fires, so the UI always reaches a retryable state.
    mockWardrobe(5);
    getCurrentPosition.mockImplementation(() => {});
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /use my location/i }));
    const opts = getCurrentPosition.mock.calls[0][2];
    expect(typeof opts?.timeout).toBe("number");
    expect(opts.timeout).toBeGreaterThan(0);
  });
});

describe("dashboard — the signpost re-checks when the page is shown again (#6)", () => {
  // The signpost's CTA is a plain <a href="/wardrobe"> — a FULL document navigation. A friend who
  // taps it, adds their clothes, and hits Back gets this page restored from the bfcache with React
  // state intact and NO effect re-run, so "First: add a few clothes" would still be on screen for a
  // closet that is no longer empty. `pageshow` fires on a bfcache restore where `visibilitychange`
  // does NOT, so both listeners are load-bearing — and removing the `pageshow` one left the whole
  // suite green (mutation-verified) before these two tests existed.
  function serve(counts: number[]) {
    let i = 0;
    global.fetch = jest.fn(async (url: unknown) => {
      if (String(url).startsWith("/api/wardrobe")) {
        const n = counts[Math.min(i++, counts.length - 1)];
        return {
          ok: true,
          json: async () => ({ items: Array.from({ length: n }, (_, k) => ({ id: `i${k}` })) }),
        } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  }

  it("drops the signpost on `pageshow` once the closet is no longer empty (bfcache Back)", async () => {
    serve([0, 3]); // first load: empty. after the friend adds clothes: 3 items.
    render(<Dashboard />);
    expect(await screen.findByText(/first: add a few clothes/i)).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
    await waitFor(() =>
      expect(screen.queryByText(/first: add a few clothes/i)).not.toBeInTheDocument(),
    );
  });

  it("drops it on `visibilitychange` too (tab return, no bfcache)", async () => {
    serve([0, 3]);
    render(<Dashboard />);
    expect(await screen.findByText(/first: add a few clothes/i)).toBeInTheDocument();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(screen.queryByText(/first: add a few clothes/i)).not.toBeInTheDocument(),
    );
  });
});

describe("dashboard — empty-closet signpost (#6)", () => {
  it("at 0 items: points at the wardrobe and drops the rescue teaser (false premise)", async () => {
    mockWardrobe(0);
    render(<Dashboard />);
    expect(await screen.findByText(/first: add a few clothes/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add your clothes/i })).toHaveAttribute("href", "/wardrobe");
    expect(screen.queryByText(/never quite know how to wear/i)).not.toBeInTheDocument();
  });

  it("with items: no signpost, rescue teaser restored", async () => {
    mockWardrobe(12);
    render(<Dashboard />);
    expect(await screen.findByText(/never quite know how to wear/i)).toBeInTheDocument();
    expect(screen.queryByText(/first: add a few clothes/i)).not.toBeInTheDocument();
  });

  it("never shows the signpost on an UNKNOWN count — a failed fetch must not accuse a stocked closet", async () => {
    // `null` (loading / fetch failed) is deliberately distinct from a confirmed 0. An existing
    // friend seeing "add your clothes first" would read as their closet having been wiped.
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    render(<Dashboard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/first: add a few clothes/i)).not.toBeInTheDocument();
  });
});
