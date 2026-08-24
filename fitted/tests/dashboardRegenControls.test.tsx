/**
 * Dashboard — H100: regenerate controls must survive a re-roll the way a person expects.
 *
 * A friend who locks a jacket and re-rolls means "keep the jacket until I say otherwise" — the
 * first cohort reported verbatim that "regenerate is not locking the item that was locked in the
 * original prompt". The server never returns stored controls to the browser, so the client (the
 * author of every re-roll's controls) remembers the locks it last submitted and seeds the next
 * RegenerateModal with them, intersected with the displayed outfit's items.
 *
 * Avoids are deliberately one-shot: the engine excludes an avoided item from every child
 * candidate, so an inherited avoid could never be displayed or cleared in the modal, and silent
 * accumulation starves a small closet (a live friend closet has six items) into "nothing
 * buildable" with no visible cause.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
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

const FLAGS = { notEnoughItems: false, insufficientAfterGeneration: false, spreadCollapsed: false, reasonHint: null };
const ROOT_ID = "6a4eb442443135439ac080d9";
const CHILD_ID = "6a4eb442443135439ac080da";

const TEE = { itemId: "i1", name: "Blue tee", clothingType: "top" };
const JEANS = { itemId: "i2", name: "Black jeans", clothingType: "bottom" };
const CHINOS = { itemId: "i3", name: "Tan chinos", clothingType: "bottom" };

const ROOT_RENDER = {
  shown: [{ snapshotId: ROOT_ID, candidateId: "cand-1", displayItems: [TEE, JEANS], styleMove: null }],
  flags: FLAGS,
  bindable: true,
};
// The child of a re-roll that locked the tee and avoided the jeans: tee kept, jeans gone.
const CHILD_RENDER = {
  shown: [{ snapshotId: CHILD_ID, candidateId: "cand-2", displayItems: [TEE, CHINOS], styleMove: null }],
  flags: FLAGS,
  bindable: true,
  generationIndex: 1,
  parentSnapshotId: ROOT_ID,
};
// An engine-anomaly child that dropped the locked tee (locks are a hard constraint, so this
// shouldn't happen — but an inherited lock for an item not on screen must not be smuggled through).
const CHILD_WITHOUT_TEE = {
  shown: [{ snapshotId: CHILD_ID, candidateId: "cand-3", displayItems: [JEANS, CHINOS], styleMove: null }],
  flags: FLAGS,
  bindable: true,
  generationIndex: 1,
  parentSnapshotId: ROOT_ID,
};

/** Serve /api/recommend from `renders` in order (last one repeats), recording each request body. */
function mockApi(renders: unknown[]): { recommendBodies: Record<string, unknown>[] } {
  const recommendBodies: Record<string, unknown>[] = [];
  let call = 0;
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/wardrobe")) {
      return { ok: true, json: async () => ({ items: [{ id: "i1" }, { id: "i2" }, { id: "i3" }] }) } as Response;
    }
    if (u === "/api/recommend") {
      recommendBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const r = renders[Math.min(call, renders.length - 1)];
      call += 1;
      return { ok: true, status: 200, json: async () => r } as Response;
    }
    if (u.startsWith("/api/interactions")) {
      return { ok: true, json: async () => ({ interactions: [] }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return { recommendBodies };
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

/** The regenerate modal's container (its intro copy is unique to it). */
function regenModal(): HTMLElement {
  return screen.getByText(/lock the pieces you want to keep/i).closest(".fixed") as HTMLElement;
}

async function openRegenModal() {
  await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  await screen.findByText(/lock the pieces you want to keep/i);
  return regenModal();
}

/** The modal row for one item, holding its Keep/Avoid toggles. */
function itemRow(modal: HTMLElement, name: string): HTMLElement {
  return within(modal).getByText(name).closest("div.p-3") as HTMLElement;
}

async function submitRegenerate(modal: HTMLElement) {
  await userEvent.click(within(modal).getByRole("button", { name: "Regenerate" }));
}

describe("dashboard — H100: a lock survives the next re-roll; an avoid does not", () => {
  it("re-opens the modal with the lock still held and re-sends it untouched", async () => {
    const { recommendBodies } = mockApi([ROOT_RENDER, CHILD_RENDER]);
    render(<Dashboard />);
    await generate();
    await screen.findAllByText("Blue tee");

    // Re-roll #1: lock the tee, avoid the jeans.
    let modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keep" }));
    await userEvent.click(within(itemRow(modal, "Black jeans")).getByRole("button", { name: "Avoid" }));
    await submitRegenerate(modal);
    await screen.findByText(/variation 1/i);
    expect(recommendBodies[1].controls).toEqual({ lockedItemIds: ["i1"], dislikedItemIds: ["i2"] });

    // Re-roll #2: the modal opens with the tee ALREADY locked (the friend's complaint), and the
    // avoid gone (one-shot — the jeans aren't even in this outfit to toggle).
    modal = await openRegenModal();
    expect(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keeping" })).toBeInTheDocument();
    expect(within(modal).queryByRole("button", { name: "Avoiding" })).not.toBeInTheDocument();

    // Submitting without touching anything re-sends the lock — and no stale avoid.
    await submitRegenerate(modal);
    await waitFor(() => expect(recommendBodies).toHaveLength(3));
    expect(recommendBodies[2].controls).toEqual({ lockedItemIds: ["i1"], dislikedItemIds: [] });
  });

  it("the lock can be released — unlocking then submitting clears it for the next roll", async () => {
    const { recommendBodies } = mockApi([ROOT_RENDER, CHILD_RENDER]);
    render(<Dashboard />);
    await generate();
    await screen.findAllByText("Blue tee");

    let modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keep" }));
    await submitRegenerate(modal);
    await screen.findByText(/variation 1/i);

    // The inherited lock is a toggle, not a cage: unlock and re-roll.
    modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keeping" }));
    await submitRegenerate(modal);
    await waitFor(() => expect(recommendBodies).toHaveLength(3));
    expect(recommendBodies[2].controls).toEqual({ lockedItemIds: [], dislikedItemIds: [] });

    // And the release itself sticks: the next open holds nothing.
    modal = await openRegenModal();
    expect(within(modal).queryByRole("button", { name: "Keeping" })).not.toBeInTheDocument();
  });

  it("a fresh root render starts a clean lineage — no lock carries over, no controls in the body", async () => {
    const { recommendBodies } = mockApi([ROOT_RENDER, CHILD_RENDER, ROOT_RENDER]);
    render(<Dashboard />);
    await generate();
    await screen.findAllByText("Blue tee");

    const modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keep" }));
    await submitRegenerate(modal);
    await screen.findByText(/variation 1/i);

    // A new Generate is a new lineage (§C.3: a root render must not carry controls).
    await userEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
    await waitFor(() => expect(recommendBodies).toHaveLength(3));
    expect(recommendBodies[2]).not.toHaveProperty("controls");
    await screen.findAllByText("Black jeans");

    const freshModal = await openRegenModal();
    expect(within(freshModal).queryByRole("button", { name: "Keeping" })).not.toBeInTheDocument();
  });

  it("the lock survives a reload — the restored render seeds the modal from the saved lineage", async () => {
    mockApi([ROOT_RENDER, CHILD_RENDER]);
    const first = render(<Dashboard />);
    await generate();
    await screen.findAllByText("Blue tee");

    let modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keep" }));
    await submitRegenerate(modal);
    await screen.findByText(/variation 1/i);
    await waitFor(() =>
      expect(window.sessionStorage.getItem("fitted_dashboard_v2:u1") ?? "").toContain("activeLockedItemIds"),
    );
    first.unmount();

    render(<Dashboard />);
    await screen.findByText(/variation 1/i);
    modal = await openRegenModal();
    expect(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keeping" })).toBeInTheDocument();
  });

  it("an inherited lock for an item not in the displayed outfit is dropped, not smuggled through", async () => {
    const { recommendBodies } = mockApi([ROOT_RENDER, CHILD_WITHOUT_TEE]);
    render(<Dashboard />);
    await generate();
    await screen.findAllByText("Blue tee");

    let modal = await openRegenModal();
    await userEvent.click(within(itemRow(modal, "Blue tee")).getByRole("button", { name: "Keep" }));
    await submitRegenerate(modal);
    await screen.findByText(/variation 1/i);

    // The tee is gone from the shown outfit — the lock cannot be displayed, so it must not be held.
    modal = await openRegenModal();
    expect(within(modal).queryByRole("button", { name: "Keeping" })).not.toBeInTheDocument();
    await submitRegenerate(modal);
    await waitFor(() => expect(recommendBodies).toHaveLength(3));
    expect(recommendBodies[2].controls).toEqual({ lockedItemIds: [], dislikedItemIds: [] });
  });
});
