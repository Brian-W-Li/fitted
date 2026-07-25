/**
 * §23-H77(a) END-TO-END: the real WardrobePage handler must EMIT the saved-but-photo-failed signal.
 *
 * addItemModal.test.tsx proves the modal CONSUMES the signal, but it injects `onSave` directly — so
 * it cannot catch the original defect, which lived in the page-level handler: after the item POST
 * succeeded and the image POST threw, the catch called only the page-level `setError` (a banner
 * rendered BEHIND the modal's `fixed inset-0 z-40` overlay) and fell through returning `undefined`,
 * which `submitForm` reads as clean success. The item saved photo-less with nothing on screen, and
 * on a 15-30 item batch-add it repeated silently. This drives the real page over a mocked fetch.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "u1", getIdToken: async () => "tok" });
    return () => {};
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WardrobePage = (require("@/app/(app)/wardrobe/page") as { default: React.ComponentType }).default;

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

/** Item-create succeeds; the photo upload fails with `imageStatus`. */
function mockApi(imageStatus: number, imageBody: unknown) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/cv/status") return ok({ available: false, reason: "not_configured" });
    if (u === "/api/wardrobe" && (init?.method ?? "GET") === "GET") return ok({ items: [] });
    if (u === "/api/wardrobe" && init?.method === "POST") {
      return ok({ item: { _id: "item123", name: "Blue tee", category: "top", colors: [] } });
    }
    if (/^\/api\/wardrobe\/item123\/image$/.test(u)) {
      return { ok: false, status: imageStatus, json: async () => imageBody } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

/** Walk the real add flow to the confirm form with a photo attached, then fill the required fields. */
async function reachConfirmFormWithPhoto(container: HTMLElement, name: string) {
  await userEvent.click(await screen.findByRole("button", { name: /\+ add item/i }));
  // CV is off in prod, so the upload step's primary action is "Continue →".
  const uploadInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(uploadInput, {
    target: { files: [new File(["x"], "tee.jpg", { type: "image/jpeg" })] },
  });
  await userEvent.click(await screen.findByRole("button", { name: /continue/i }));
  // Required set is {name, category} (REQFIELDS-1).
  await userEvent.type(await screen.findByPlaceholderText(/blue denim jacket/i), name);
  fireEvent.change(screen.getByDisplayValue("Select a category…"), { target: { value: "top" } });
}

afterEach(() => jest.clearAllMocks());

describe("wardrobe page — 'Save & add another' never loses a photo silently (§23-H77(a))", () => {
  it("a 429 on the photo upload surfaces INSIDE the modal, naming the item, and still resets", async () => {
    mockApi(429, { error: "Too many photo uploads at once — wait a moment and try again" });
    const { container } = render(<WardrobePage />);
    await reachConfirmFormWithPhoto(container, "Blue tee");

    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));

    // The whole point: visible, in-modal (not the overlay-hidden page banner), and it says WHICH item.
    const notice = await screen.findByTestId("photo-warnings");
    expect(notice).toHaveTextContent(/Blue tee/);
    expect(notice).toHaveTextContent(/Too many photo uploads/);
    expect(notice).toHaveTextContent(/Add it from Edit/);

    // The item WAS created, so the modal must still reset for the next item — never strand the old
    // values, which would invite a re-save that mints a duplicate.
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe(""),
    );
  });

  it("the same holds for the post-compression size rejection (413)", async () => {
    mockApi(413, { error: "Image too large (max 5MB)" });
    const { container } = render(<WardrobePage />);
    await reachConfirmFormWithPhoto(container, "Blue tee");
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));

    const notice = await screen.findByTestId("photo-warnings");
    expect(notice).toHaveTextContent(/Image too large/);
  });

  it("a CLEAN save shows no warning (the signal is failure-only, not noise on every add)", async () => {
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/cv/status") return ok({ available: false, reason: "not_configured" });
      if (u === "/api/wardrobe" && (init?.method ?? "GET") === "GET") return ok({ items: [] });
      if (u === "/api/wardrobe" && init?.method === "POST") {
        return ok({ item: { _id: "item123", name: "Blue tee", category: "top", colors: [] } });
      }
      if (/^\/api\/wardrobe\/item123\/image$/.test(u)) return ok({ imagePath: "mongo:img1" });
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { container } = render(<WardrobePage />);
    await reachConfirmFormWithPhoto(container, "Blue tee");
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));

    await waitFor(() =>
      expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe(""),
    );
    expect(screen.queryByTestId("photo-warnings")).not.toBeInTheDocument();
  });
});

describe("wardrobe page — the EDIT path signals a lost photo too (§23-H77(a))", () => {
  // The edit branch has no "add another", so its warning object always lands on the close path and
  // the in-modal notice never paints. What IS observable — and what a friend actually sees — is the
  // page-level banner once the overlay is gone. Pinning that keeps the edit half from silently
  // regressing to "the edit saved, the photo vanished, nothing said so".
  const existing = {
    _id: "item123",
    id: "item123",
    name: "Blue tee",
    category: "top",
    colors: [],
    seasons: [],
    occasions: [],
    fit: "",
    size: "",
  };

  function mockEditApi(imageOk: boolean) {
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/cv/status") return ok({ available: false, reason: "not_configured" });
      if (u === "/api/wardrobe" && (init?.method ?? "GET") === "GET") return ok({ items: [existing] });
      if (u === "/api/wardrobe/item123" && init?.method === "PATCH") return ok({ item: existing });
      if (/^\/api\/wardrobe\/item123\/image$/.test(u)) {
        return imageOk
          ? ok({ imagePath: "mongo:img1" })
          : ({ ok: false, status: 429, json: async () => ({ error: "Too many photo uploads at once" }) } as Response);
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  }

  it("a failed photo upload during an edit is reported, and says the item changes DID save", async () => {
    mockEditApi(false);
    const { container } = render(<WardrobePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    // Attach a photo to the (photo-less) item, then save.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "tee.jpg", { type: "image/jpeg" })] },
    });
    await userEvent.click(await screen.findByRole("button", { name: /^save item$/i }));

    // Visible once the modal closes, and it distinguishes "photo failed" from "edit failed" —
    // otherwise "try again" reads as redo-the-edit.
    const banner = await screen.findByText(/your item changes were saved/i);
    expect(banner).toHaveTextContent(/Too many photo uploads/);
    expect(banner).toHaveTextContent(/retry the photo from Edit/i);
  });

  it("a successful edit upload shows no banner", async () => {
    mockEditApi(true);
    const { container } = render(<WardrobePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "tee.jpg", { type: "image/jpeg" })] },
    });
    await userEvent.click(await screen.findByRole("button", { name: /^save item$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^save item$/i })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/your item changes were saved/i)).not.toBeInTheDocument();
  });
});
