/**
 * Client-component behavioral tests for the wardrobe add/edit modal
 * (wardrobe-ingestion-honesty-pass D5 — the two behaviors that can corrupt friend data).
 *
 * AddItemModal lives inside app/(app)/wardrobe/page.tsx; importing that module pulls in the
 * page-level Firebase client, so we mock it (the modal itself never touches Firebase — it is a
 * pure props-driven component whose only outside effect is the injected onSave).
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AddItemModal } = require("@/app/(app)/wardrobe/page") as typeof import("@/app/(app)/wardrobe/page");

// A fully-valid form payload so validateWardrobeForm passes without simulated typing — lets each
// test isolate the photo-gate behavior. (WardrobeFormValues = Omit<WardrobeItem,"id">.)
const validItem = {
  name: "Blue tee",
  category: "top",
  subCategory: "t-shirt",
  colors: ["navy"],
  fit: "",
  size: "",
  seasons: [] as string[],
  occasions: [] as string[],
};

describe("AddItemModal — harness smoke", () => {
  it("renders the confirm/save form with the required-field sections", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} title="Add item" />);
    expect(screen.getByText(/^Colors/i)).toBeInTheDocument();
    expect(screen.getByText(/Category \*/i)).toBeInTheDocument();
  });
});

describe("AddItemModal — photo strong-nudge gate (D1)", () => {
  it("with NO photo: offers a deliberate 'Save without a photo', and no plain 'Save item'", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />);
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save without a photo/i })).toBeInTheDocument();
    // The photo-less save must never be the default primary button.
    expect(screen.queryByRole("button", { name: /save item/i })).not.toBeInTheDocument();
  });

  it("saves photo-less ONLY via the deliberate action, passing imageFile=null", async () => {
    const onSave = jest.fn((_item: unknown, _file: File | null) => true);
    render(<AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} />);
    await userEvent.click(screen.getByRole("button", { name: /save without a photo/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toBeNull();
  });

  it("with a photo attached: shows 'Save item' and passes the File to onSave", async () => {
    const onSave = jest.fn((_item: unknown, _file: File | null) => true);
    const file = new File(["x"], "tee.jpg", { type: "image/jpeg" });
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={file} />,
    );
    const saveBtn = screen.getByRole("button", { name: /save item/i });
    expect(saveBtn).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save without a photo/i })).not.toBeInTheDocument();
    await userEvent.click(saveBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toBe(file);
  });
});

describe("AddItemModal — double-submit re-entrancy latch (no duplicate item)", () => {
  it("two submit events in one tick call onSave exactly once", async () => {
    // A sub-frame double-tap fires two submit events before `disabled={saving}` re-renders. Firing
    // the form's submit directly reproduces that (and bypasses the disabled-button mitigation), so
    // this isolates the savingRef latch: without it the add path would POST twice → duplicate item.
    let resolveSave: ((v: boolean) => void) | undefined;
    const onSave = jest.fn(() => new Promise<boolean>((r) => { resolveSave = r; }));
    const file = new File(["x"], "tee.jpg", { type: "image/jpeg" });
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={file} />,
    );
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    resolveSave?.(true);
  });
});

describe("AddItemModal — Save & add another (B1 yield-friction removal)", () => {
  const withPhoto = () => new File(["x"], "tee.jpg", { type: "image/jpeg" });

  it("offers 'Save & add another' only in ADD mode with a photo — never in edit", () => {
    // add + photo → present
    const { unmount } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    expect(screen.getByRole("button", { name: /save & add another/i })).toBeInTheDocument();
    unmount();
    // edit (existingImagePath) → absent, even though a photo is present
    render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} existingImagePath="mongo:abc" />,
    );
    expect(screen.queryByRole("button", { name: /save & add another/i })).not.toBeInTheDocument();
  });

  it("saves, keeps the modal open, and RESETS the form (name cleared, back to photo-first) — onClose NOT called", async () => {
    const onSave = jest.fn((_item: unknown, _file: File | null) => true);
    const onClose = jest.fn();
    render(
      <AddItemModal onClose={onClose} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    // pre-condition: the name field carries the item name, photo path is active
    const nameInput = screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Blue tee");

    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // modal stays open (onClose never fired) …
    expect(onClose).not.toHaveBeenCalled();
    // … the form is blanked for the next item …
    expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe("");
    // … and the photo is cleared, so the next item starts on the photo-first path (D1).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save without a photo/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^save item$/i })).not.toBeInTheDocument();
  });

  it("rapid double-tap of 'Save & add another' saves exactly once (latch holds on the new path)", async () => {
    // The add-another button reopens the exact form that has NO server idempotency; a sub-frame
    // double-tap must not POST twice. Reuse the savingRef latch: a deferred onSave keeps the first
    // call in flight while the second tap fires.
    let resolveSave: ((v: boolean) => void) | undefined;
    const onSave = jest.fn(() => new Promise<boolean>((r) => { resolveSave = r; }));
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    const btn = screen.getByRole("button", { name: /save & add another/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    resolveSave?.(true);
  });
});

describe("AddItemModal — collapsed 'More details' still submit (D2)", () => {
  it("Pattern + Fit (in the optional disclosure) still reach the onSave payload — collapse doesn't drop data", async () => {
    const onSave = jest.fn((_item: unknown, _file: File | null) => true);
    const file = new File(["x"], "tee.jpg", { type: "image/jpeg" });
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={file} />,
    );
    // The <details> is collapsed by default, but the fields stay mounted — the whole point of the
    // D2 collapse (simplify the form without dropping the wire shape). Set them without expanding.
    await userEvent.selectOptions(screen.getByLabelText("Pattern"), "striped");
    await userEvent.selectOptions(screen.getByLabelText("Fit"), "Slim");
    await userEvent.click(screen.getByRole("button", { name: /save item/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0] as { pattern?: string; fit?: string };
    expect(payload.pattern).toBe("striped");
    expect(payload.fit).toBe("Slim");
  });
});

describe("AddItemModal — photo preview (iOS tab-switch resilience + enlarge)", () => {
  const photo = () => new File(["x"], "tee.jpg", { type: "image/jpeg" });

  it("renders the picked photo as data: URLs, never blob: object URLs (iOS tab-switch safety)", async () => {
    // The preview must be a `data:` URL (a plain string in React state) so it survives an iOS WebKit
    // tab-switch, which reclaims the blob backing a `blob:` object URL and blanks the <img>. Reverting
    // to URL.createObjectURL would make these src `blob:…` and redden the test.
    render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} pendingAddFile={photo()} addStep="form" />,
    );
    // Wait for the async FileReader read to land (the enlarge triggers only render once previewUrl is set).
    await screen.findAllByRole("button", { name: "Enlarge photo" });
    const previewSrcs = Array.from(document.querySelectorAll("img"))
      .map((i) => i.getAttribute("src") ?? "")
      .filter((s) => s.startsWith("data:") || s.startsWith("blob:"));
    expect(previewSrcs.length).toBeGreaterThan(0);
    for (const src of previewSrcs) {
      expect(src).toMatch(/^data:image\//);
      expect(src).not.toMatch(/^blob:/);
    }
  });

  it("makes the HEADER thumbnail tap-to-enlarge (not only the large preview)", async () => {
    render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} pendingAddFile={photo()} addStep="form" />,
    );
    // With a photo attached there are two enlarge affordances: the header thumbnail (this fix, first in
    // DOM order) + the main preview. Losing the header button drops this to 1 and reddens the test.
    const enlargeBtns = await screen.findAllByRole("button", { name: "Enlarge photo" });
    expect(enlargeBtns).toHaveLength(2);
    expect(screen.queryByLabelText("Close enlarged photo")).not.toBeInTheDocument();
    await userEvent.click(enlargeBtns[0]); // the header thumbnail
    expect(screen.getByLabelText("Close enlarged photo")).toBeInTheDocument();
  });
});

describe("AddItemModal — CV-honest intro copy (F6)", () => {
  it("shows the honest manual-entry copy when CV is unavailable (the prod default)", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} title="Add item" addStep="upload" cvUnavailable={true} />);
    expect(screen.getByText(/fill in a few quick details/i)).toBeInTheDocument();
    // Never promises CV suggestions while CV is off.
    expect(screen.queryByText(/suggest category/i)).not.toBeInTheDocument();
  });

  it("shows the CV-suggest copy only when CV is genuinely available", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} title="Add item" addStep="upload" cvUnavailable={false} />);
    expect(screen.getByText(/suggest category/i)).toBeInTheDocument();
  });
});

describe("AddItemModal — Type taxonomy", () => {
  it("offers 'Sweatshirt' as a Type option (a crewneck had no home before)", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />);
    expect(screen.getByRole("option", { name: "Sweatshirt" })).toBeInTheDocument();
  });
});

describe("AddItemModal — Category must be chosen (F2 corpus-integrity)", () => {
  it("a fresh add starts on a 'Select a category…' placeholder, not a silent 'Top'", () => {
    const file = new File(["x"], "tee.jpg", { type: "image/jpeg" });
    render(<AddItemModal onClose={() => {}} onSave={() => true} pendingAddFile={file} addStep="form" />);
    const placeholder = screen.getByRole("option", { name: /select a category/i });
    const select = placeholder.closest("select") as HTMLSelectElement;
    expect(select.value).toBe(""); // NOT "top"
  });

  it("blocks save while Category is unchosen, then clears once a category is picked", async () => {
    const onSave = jest.fn((_i: unknown, _f: File | null) => true);
    const file = new File(["x"], "tee.jpg", { type: "image/jpeg" });
    render(<AddItemModal onClose={() => {}} onSave={onSave} pendingAddFile={file} addStep="form" />);
    // Valid name so Category is the only blocker.
    await userEvent.type(screen.getByPlaceholderText(/blue denim jacket/i), "Mystery item");
    const select = screen.getByRole("option", { name: /select a category/i }).closest("select") as HTMLSelectElement;

    // Unchosen → save is blocked (the required select is constraint-invalid), onSave never fires.
    await userEvent.click(screen.getByRole("button", { name: /save item/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(select.validity.valueMissing).toBe(true);

    // Pick a real category → the block clears and the save goes through.
    await userEvent.selectOptions(select, "footwear");
    expect(select.validity.valueMissing).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: /save item/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { category: string }).category).toBe("footwear");
  });
});

describe("AddItemModal — edit can clear an optional select (Type/subCategory)", () => {
  // Regression: on EDIT, clearing the Type dropdown back to "Select…" must reach the PATCH as an
  // explicit "" (a clear), not be dropped. submitForm previously sent `subCategory || undefined`,
  // so the "" collapsed to undefined, JSON.stringify dropped it, and the PATCH left the old Type in
  // place — a silent no-op unlike pattern/layerRole, which carry the isEdit clear-branch. (Reachable
  // now that REQFIELDS-1 makes subCategory optional; a valid item can carry an empty Type.)
  // existingImagePath puts the modal in edit mode with a photo, so the primary "Save item" shows.
  const editableItem = { ...validItem, subCategory: "t-shirt" };

  it("clearing Type on edit sends subCategory:'' (explicit clear), not a dropped field", async () => {
    const onSave = jest.fn((_i: unknown, _f: File | null) => true);
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={onSave}
        initialItem={editableItem}
        existingImagePath="mongo:abc"
        title="Edit clothing item"
      />,
    );
    // The Type <select> currently displays the item's "t-shirt" value; set it back to "Select…" ("").
    const typeSelect = screen.getByDisplayValue("T-Shirt") as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: "" } });

    await userEvent.click(screen.getByRole("button", { name: /save item/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The load-bearing assertion: "" is present in the payload (an explicit clear), not undefined.
    expect((onSave.mock.calls[0][0] as { subCategory?: string }).subCategory).toBe("");
  });

  it("keeping Type on edit still sends the value", async () => {
    const onSave = jest.fn((_i: unknown, _f: File | null) => true);
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={onSave}
        initialItem={editableItem}
        existingImagePath="mongo:abc"
        title="Edit clothing item"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save item/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { subCategory?: string }).subCategory).toBe("t-shirt");
  });
});

describe("AddItemModal — 'Files as' slot chip (clothingtype-slot-correctness §4-C visibility)", () => {
  it("derives Bottom for the suit-dress mis-slot shape (structural signals beat the name)", () => {
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={() => true}
        initialItem={{ ...validItem, name: "suit dress", category: "bottom", subCategory: "skirt" }}
      />,
    );
    // The live-corpus failure shape: set-name "dress" over category=bottom/sub=skirt. The chip
    // must show the ENGINE's slot so the contradiction is visible before save.
    expect(screen.getByTestId("files-as-chip")).toHaveTextContent(/Files as:\s*Bottom/);
  });

  it("re-derives live as the category changes (the same real deriveClothingType, pre-save)", () => {
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={() => true}
        initialItem={{ ...validItem, name: "wrap dress", category: "one piece", subCategory: "" }}
      />,
    );
    expect(screen.getByTestId("files-as-chip")).toHaveTextContent(/Files as:\s*Dress/);
    const categorySelect = screen.getByDisplayValue("One piece") as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "bottom" } });
    expect(screen.getByTestId("files-as-chip")).toHaveTextContent(/Files as:\s*Bottom/);
  });

  it("stays hidden on an empty form (a bare default 'Top' would be noise)", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} title="Add item" />);
    expect(screen.queryByTestId("files-as-chip")).not.toBeInTheDocument();
  });
});

describe("AddItemModal — saved-but-photo-failed signal (§23-H77(a))", () => {
  const withPhoto = () => new File(["x"], "tee.jpg", { type: "image/jpeg" });
  const warn = (msg: string) => ({ savedWithPhotoWarning: msg });

  /** Fill the blanked form so a SECOND "Save & add another" can pass validation, as a friend
   *  entering their next item would. Required set is {name, category} (REQFIELDS-1). */
  async function fillNextItem(name: string) {
    await userEvent.type(screen.getByPlaceholderText(/blue denim jacket/i), name);
    fireEvent.change(screen.getByDisplayValue("Select a category…"), { target: { value: "bottom" } });
  }

  it("treats the warning as SUCCESS — resets for the next item instead of stranding the form", async () => {
    // The regression: the page handler returned undefined after a failed photo upload, so the modal
    // reset and the item saved photo-less with NOTHING on screen (the page banner sits behind the
    // z-40 overlay). The warning must both reset the form AND be visible.
    const onSave = jest.fn(() => warn('Saved "Blue tee", but its photo didn’t upload — 429. Add it from Edit.'));
    const onClose = jest.fn();
    render(
      <AddItemModal onClose={onClose} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // Visible, inside the modal, naming the item.
    const notice = await screen.findByTestId("photo-warnings");
    expect(notice).toHaveTextContent(/Blue tee/);
    expect(notice).toHaveTextContent(/photo didn’t upload/);
    // Not treated as a failure: the form blanked for the next item and the modal stayed open.
    expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    // And it is NOT rendered as the red form error (that path would imply "your save failed").
    expect(screen.queryByText(/^Name is required\.$/)).not.toBeInTheDocument();
  });

  it("ACCUMULATES one entry per lost photo — a 429 burst must not collapse to a single name", async () => {
    const onSave = jest
      .fn()
      .mockReturnValueOnce(warn("Saved “Blue tee”, but its photo didn’t upload."))
      .mockReturnValueOnce(warn("Saved “Grey jeans”, but its photo didn’t upload."));
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    await screen.findByTestId("photo-warnings");

    await fillNextItem("Grey jeans");
    await userEvent.click(screen.getByRole("button", { name: /save without a photo/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    // Both items are still named — losing the first name would make its remedy unactionable.
    const notice = screen.getByTestId("photo-warnings");
    expect(notice).toHaveTextContent(/Blue tee/);
    expect(notice).toHaveTextContent(/Grey jeans/);
    expect(notice.querySelectorAll("li")).toHaveLength(2);
  });

  it("a later CLEAN save does not clear earlier warnings — they are a to-do list, not a toast", async () => {
    const onSave = jest
      .fn()
      .mockReturnValueOnce(warn("Saved “Blue tee”, but its photo didn’t upload."))
      .mockReturnValueOnce(true);
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    await screen.findByTestId("photo-warnings");

    await fillNextItem("Grey jeans");
    await userEvent.click(screen.getByRole("button", { name: /save without a photo/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    // The FIRST item still has no photo — a clean second save doesn't change that.
    expect(screen.getByTestId("photo-warnings")).toHaveTextContent(/Blue tee/);
  });

  it("Dismiss clears the list", async () => {
    const onSave = jest.fn(() => warn("Saved “Blue tee”, but its photo didn’t upload."));
    render(
      <AddItemModal onClose={() => {}} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} addStep="form" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    const notice = await screen.findByTestId("photo-warnings");
    // Scoped: the CV quick-guide has its own Dismiss / Dismiss-forever buttons.
    await userEvent.click(within(notice).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("photo-warnings")).not.toBeInTheDocument();
  });

  it("on a NORMAL save the warning still counts as success — the modal closes (no duplicate re-save)", async () => {
    // The item WAS created; keeping the modal open with the old values would invite a re-save that
    // mints a duplicate. Closing is correct — the page-level banner is visible once the overlay goes.
    const onSave = jest.fn(() => warn("Saved “Blue tee”, but its photo didn’t upload."));
    const onClose = jest.fn();
    render(
      <AddItemModal onClose={onClose} onSave={onSave} initialItem={validItem} pendingAddFile={withPhoto()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^save item$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("AddItemModal — pick-time size ceiling (§23-H77(b))", () => {
  /** A File whose reported size is `bytes` without allocating them. */
  function sizedFile(bytes: number, name = "big.jpg") {
    const f = new File(["x"], name, { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  }
  const pick = (container: HTMLElement, file: File) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  };

  it("ACCEPTS a photo over the old 5MB gate — the 1280px downscaler is the real limit, not the pick", async () => {
    // The dead end: an 8MB iPhone JPEG (exactly what the app's own "Camera → Most Compatible"
    // advice produces) was rejected at pick, so prepareImageForUpload never ran and the friend got
    // a remedy-free "Max image size is 5MB."
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    pick(container, sizedFile(8 * 1024 * 1024));
    // Accepted → the photo path is live (D1 primary save), and no error is shown.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save item$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Max image size is 5MB/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/larger than we can handle/i)).not.toBeInTheDocument();
  });

  it("still rejects a file past the sanity ceiling, and says how big it was", async () => {
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    pick(container, sizedFile(45 * 1024 * 1024));
    expect(await screen.findByText(/45MB — larger than we can handle/i)).toBeInTheDocument();
    // Rejected → still on the photo-less path.
    expect(screen.getByRole("button", { name: /save without a photo/i })).toBeInTheDocument();
  });
});

describe("AddItemModal — the preview renders from the DOWNSCALED copy (§23-H77(b) memory guard)", () => {
  // Raising the pick ceiling to 40MB made the preview the memory risk: a base64 data URL is ~4/3 the
  // file size and lives as a plain string in React state, so previewing a raw 40MB pick would be
  // ~53MB — enough to kill an iOS tab. jsdom has no createImageBitmap/canvas encoder, so these stub
  // a WORKING downscaler; without the stubs prepareImageForUpload falls back to the original and the
  // distinction under test would be invisible (which is exactly how this shipped unpinned).
  const BIG = 3 * 1024 * 1024; // over the 400KB skip-threshold, so the downscale actually runs
  let origCreate: unknown;
  let origToBlob: unknown;

  beforeEach(() => {
    origCreate = (globalThis as Record<string, unknown>).createImageBitmap;
    origToBlob = HTMLCanvasElement.prototype.toBlob;
    (globalThis as Record<string, unknown>).createImageBitmap = jest.fn(async () => ({
      width: 4000,
      height: 3000,
      close: () => {},
    }));
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: () => {} })) as never;
    // The "downscaled" result: two orders of magnitude smaller than the original.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob([new Uint8Array(4096)], { type: "image/jpeg" }));
    } as never;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).createImageBitmap = origCreate;
    HTMLCanvasElement.prototype.toBlob = origToBlob as never;
    jest.restoreAllMocks();
  });

  function sizedFile(bytes: number) {
    const f = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  }

  it("holds the SMALL re-encoded data URL, not one derived from the multi-MB original", async () => {
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(BIG)] } });

    const img = (await screen.findByAltText("Item photo")) as HTMLImageElement;
    // 4KB downscaled → a base64 URL in the low thousands of chars. The 3MB original would yield
    // ~4,000,000 — so this bound fails loudly if the preview ever reverts to the raw file.
    expect(img.src.startsWith("data:")).toBe(true);
    expect(img.src.length).toBeLessThan(100_000);
    // And the downscaler was genuinely exercised (not skipped by the <400KB early return).
    expect((globalThis as Record<string, unknown>).createImageBitmap).toHaveBeenCalled();
  });

  it("skips the preview entirely when the downscale FAILS on a huge file (no ~53MB string)", async () => {
    // Decode failure → prepareImageForUpload returns the ORIGINAL. A 20MB original must not become
    // a data URL; the photo is still selected and still uploads.
    (globalThis as Record<string, unknown>).createImageBitmap = jest.fn(async () => {
      throw new Error("decode OOM");
    });
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(20 * 1024 * 1024)] } });

    // The pick was accepted (photo path live) …
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save item$/i })).toBeInTheDocument(),
    );
    // … but no preview image was ever built from the oversized original.
    expect(screen.queryByAltText("Item photo")).not.toBeInTheDocument();
  });
});
