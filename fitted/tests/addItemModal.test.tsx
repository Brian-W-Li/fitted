/**
 * Client-component behavioral tests for the wardrobe add/edit modal
 * (wardrobe-ingestion-honesty-pass D5 — the two behaviors that can corrupt friend data).
 *
 * AddItemModal lives inside app/(app)/wardrobe/page.tsx; importing that module pulls in the
 * page-level Firebase client, so we mock it (the modal itself never touches Firebase — it is a
 * pure props-driven component whose only outside effect is the injected onSave).
 */
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AddItemModal, MAX_UPLOAD_BYTES } = require("@/app/(app)/wardrobe/page") as typeof import("@/app/(app)/wardrobe/page");

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

/** Give jsdom a WORKING image downscaler for the duration of `run`, then restore exactly what was
 *  there before. jsdom ships no `createImageBitmap` and no canvas encoder, so without this
 *  `prepareImageForUpload` always falls back to the original file — which silently inverts any test
 *  about size gating (a "large file is accepted" test would really be exercising the rejection
 *  path). Restores by hand: these are plain prototype assignments, which `jest.restoreAllMocks()`
 *  does NOT undo, so leaving them installed leaks a mocked `getContext` into every later describe. */
let restoreDownscaler: (() => void) | null = null;
/** `resultBytes` is the REAL size of the stubbed downscale output — the number the post-downscale
 *  upload gate reads, so it must be real bytes, never a faked `size`. Default ~4KB (an ordinary
 *  downscale); the two boundary tests pass ABSOLUTE sizes that bracket `MAX_UPLOAD_BYTES` from
 *  outside (a size derived from the constant would move with it and pin nothing). */
function installWorkingDownscaler(resultBytes = 4096) {
  const g = globalThis as Record<string, unknown>;
  const hadCreate = "createImageBitmap" in g;
  const origCreate = g.createImageBitmap;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  g.createImageBitmap = jest.fn(async () => ({ width: 4000, height: 3000, close: () => {} }));
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array(resultBytes)], { type: "image/jpeg" }));
  } as never;
  // Restored in afterEach, NOT synchronously after the pick: the downscale is consumed inside the
  // preview effect's async continuation, so tearing the stubs down before that await resolves would
  // silently hand the component the real (absent) jsdom implementations.
  restoreDownscaler = () => {
    if (hadCreate) g.createImageBitmap = origCreate;
    else delete g.createImageBitmap;
    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLCanvasElement.prototype.toBlob = origToBlob;
  };
}
afterEach(() => {
  restoreDownscaler?.();
  restoreDownscaler = null;
});

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

describe("AddItemModal — saved-but-photo-failed signal (DEFECTS-H77(a))", () => {
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
    // Asserted against the RED slots themselves. The previous version checked for "Name is required."
    // — a validation string `validItem` can never produce — so it passed under every behavior,
    // including the `setFormError(result.savedWithPhotoWarning)` regression it was meant to catch.
    const redText = Array.from(document.querySelectorAll("p.text-red-600"))
      .map((e) => e.textContent ?? "")
      .join(" | ");
    expect(redText).not.toMatch(/photo didn’t upload/);
    expect(within(notice).getByText(/photo didn’t upload/)).toBeInTheDocument();
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

describe("AddItemModal — pick-time size ceiling (DEFECTS-H77(b))", () => {
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
    //
    // The stub is REQUIRED, not decoration: jsdom has no createImageBitmap, so without it the
    // downscale falls back to the 8MB original, which now trips the MAX_UPLOAD_BYTES gate and the
    // pick is rejected — i.e. the unstubbed version of this test asserts the OPPOSITE of what a
    // real browser does, and passes only because `waitFor` samples before the async rejection lands.
    installWorkingDownscaler();
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    pick(container, sizedFile(8 * 1024 * 1024));
    // Accepted → the photo path is live (D1 primary save) and the thumbnail is built.
    expect(await screen.findByAltText("Item photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save item$/i })).toBeInTheDocument();
    // (The old "Max image size is 5MB" negative was dropped: that string exists nowhere in app/ or
    // lib/, so it was vacuously true under every behavior. The two live rejection messages below are
    // the ones that can actually appear.)
    expect(screen.queryByText(/larger than we can handle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/too large to upload/i)).not.toBeInTheDocument();
  });

  it("ACCEPTS a 39MB pick — the ceiling is a sanity bound, not a photo filter", async () => {
    // The accept side was pinned at 8MB, so MAX_PICK_BYTES could drop to 9MB and stay green while any
    // 9-40MB pick (a Live Photo / burst export / iPad screenshot) hit the remedy-free dead end this
    // whole describe exists to prove gone. With a working downscaler the post-downscale size is ~4KB,
    // so only the PICK gate is under test here.
    installWorkingDownscaler();
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    pick(container, sizedFile(39 * 1024 * 1024));
    expect(await screen.findByAltText("Item photo")).toBeInTheDocument();
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

describe("AddItemModal — the preview renders from the DOWNSCALED copy (DEFECTS-H77(b) memory guard)", () => {
  // Raising the pick ceiling to 40MB made the preview the memory risk: a base64 data URL is ~4/3 the
  // file size and lives as a plain string in React state, so previewing a raw 40MB pick would be
  // ~53MB — enough to kill an iOS tab.
  //
  // REAL BYTES ARE MANDATORY HERE. An earlier version of this pin used a File with one real byte and
  // a faked `size` property; FileReader reads real bytes, so BOTH the original and the downscaled
  // copy produced a ~28-character data URL and the length assertion could not tell them apart — the
  // pin was green while measuring nothing. 600KB of real bytes puts the original's data URL near
  // 800,000 chars against ~5,500 for the stubbed 4KB downscale, so the bound below genuinely bites.
  const realFile = (bytes: number, name = "big.jpg") =>
    new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

  it("holds the SMALL re-encoded data URL, not one derived from the multi-MB original", async () => {
    installWorkingDownscaler();
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // 600KB: over the 400KB skip-threshold, so the downscale genuinely runs.
    fireEvent.change(input, { target: { files: [realFile(600 * 1024)] } });

    const img = (await screen.findByAltText("Item photo")) as HTMLImageElement;
    expect(img.src.startsWith("data:")).toBe(true);
    // ~5.5K for the downscaled copy vs ~800K for the original — a revert to `readAsDataURL(imageFile)`
    // reddens this by two orders of magnitude.
    expect(img.src.length).toBeLessThan(100_000);
  });

  it("a huge file whose downscale FAILS is rejected, so no ~53MB data URL is ever built", async () => {
    // jsdom has no createImageBitmap, so prepareImageForUpload falls back to the ORIGINAL — the real
    // browser case (old iOS Safari / a decode OOM). The original is over the upload gate, so the
    // pick is refused outright rather than previewed or silently attached.
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [realFile(5 * 1024 * 1024, "huge.jpg")] } });

    expect(await screen.findByText(/too large to upload/i)).toBeInTheDocument();
    // No preview image, and nothing left attached to be saved under a false promise.
    expect(screen.queryByAltText("Item photo")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save without a photo/i })).toBeInTheDocument();
  });
});

describe("AddItemModal — a pending photo is never misrepresented by the STORED one", () => {
  // Convergence-round finding: `photoPreviewSrc` used to be `previewUrl ?? existingPhotoUrl`. A
  // preview can legitimately be absent (still building, or a FileReader error), and the fallback
  // then rendered the item's OLD stored photo while a DIFFERENT pending file was what would upload
  // — a positively false claim about the save, worse than showing no thumbnail.
  function sizedFile(bytes: number, name = "new.jpg") {
    const f = new File(["x"], name, { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  }

  /** Force the settled no-preview state on an otherwise-uploadable file: a FileReader that errors.
   *  (The other route to a missing preview — an oversized post-downscale file — is now REJECTED at
   *  pick, see the next describe.) The stub must stay installed across the effect's `await
   *  prepareImageForUpload(...)`, because `new FileReader()` is constructed AFTER that await —
   *  restoring it synchronously would let the real reader run and the preview would succeed. */
  let origFileReader: typeof FileReader;
  function installFailingFileReader() {
    origFileReader = global.FileReader;
    class ErroringReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    (global as Record<string, unknown>).FileReader = ErroringReader as never;
  }
  afterEach(() => {
    if (origFileReader) (global as Record<string, unknown>).FileReader = origFileReader as never;
  });

  it("EDIT: a replacement whose preview fails does NOT keep showing the stored photo", async () => {
    installFailingFileReader();
    const { container } = render(
      <AddItemModal
        onClose={() => {}}
        onSave={() => true}
        initialItem={validItem}
        existingImagePath="mongo:abc123"
      />,
    );
    // Pre-condition: the stored photo is on screen.
    expect((screen.getByAltText("Item photo") as HTMLImageElement).src).toContain("/api/images/abc123");
    // A small file (under the 400KB re-encode skip) so the downscale is a no-op and the ONLY
    // reason there is no preview is the reader error.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(1024)] } });

    // The stored image must be GONE — it is not what would be saved.
    await waitFor(() => expect(screen.queryByAltText("Item photo")).not.toBeInTheDocument());
    // …and once the preview attempt SETTLES (it reports "Preparing preview…" until then), the
    // pending file is honestly announced instead of silently vanishing.
    expect(await screen.findByText(/Photo selected/i)).toHaveTextContent(/new\.jpg/);
    // The enlarge hint must not point at an image that isn't rendered.
    expect(screen.queryByText(/Tap the photo to enlarge/i)).not.toBeInTheDocument();
  });

  it("EDIT: with NO new pick, the stored photo still shows (the fallback is still correct there)", () => {
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={() => true}
        initialItem={validItem}
        existingImagePath="mongo:abc123"
      />,
    );
    expect((screen.getByAltText("Item photo") as HTMLImageElement).src).toContain("/api/images/abc123");
  });

  it("ADD: a pick whose preview fails still reads as attached, not as a failed pick", async () => {
    installFailingFileReader();
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(1024)] } });

    await waitFor(() => expect(screen.getByText(/Photo selected/i)).toBeInTheDocument());
    // The photo path is live — D1's primary save, not the photo-less secondary action.
    expect(screen.getByRole("button", { name: /^save item$/i })).toBeInTheDocument();
  });
});

describe("AddItemModal — 'Preparing preview…' is a distinct THIRD state, not a settled negative", () => {
  // The downscale is a full decode + canvas re-encode of a 12MP photo — seconds on a phone. Without
  // a pending state every ordinary pick flashes the settled negative "No preview to show here"
  // before the thumbnail lands, once per item on a 15-item batch: reporting a false conclusion
  // instead of progress. Collapsing the two states left the whole suite green (mutation-verified),
  // so pin BOTH halves — in-flight says "Preparing", completed shows the photo.
  let origFileReader: typeof FileReader;
  let held: { onload: (() => void) | null; result: string | null } | null = null;
  beforeEach(() => {
    held = null;
    origFileReader = global.FileReader;
    // A plain constructor function (not a class) so the instance can be captured without aliasing
    // `this`: `new F()` returns F's object return value. The read NEVER completes on its own — that
    // suspension IS the in-flight state under test; the test fires `onload` when it wants it to land.
    (global as Record<string, unknown>).FileReader = function () {
      const inst = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        result: null as string | null,
        readAsDataURL: () => {
          held = inst;
        },
      };
      return inst;
    } as never;
  });
  afterEach(() => {
    (global as Record<string, unknown>).FileReader = origFileReader as never;
  });

  /** Under the 400KB re-encode skip, so `prepareImageForUpload` is a no-op and the ONLY thing still
   *  in flight is the held read. */
  const smallPhoto = () => new File(["x"], "slow.jpg", { type: "image/jpeg" });

  it("confirm form: reports progress while the read is in flight, then swaps in the photo", async () => {
    render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} pendingAddFile={smallPhoto()} />,
    );
    expect(await screen.findByText(/Preparing preview/i)).toHaveTextContent(/slow\.jpg/);
    // The load-bearing negative: a settled "nothing to show" must NOT appear while still working.
    expect(screen.queryByText(/No preview to show here/i)).not.toBeInTheDocument();

    await waitFor(() => expect(held).not.toBeNull());
    await act(async () => {
      held!.result = "data:image/jpeg;base64,AAAA";
      held!.onload?.();
    });
    expect(await screen.findByAltText("Item photo")).toBeInTheDocument();
    expect(screen.queryByText(/Preparing preview/i)).not.toBeInTheDocument();
  });

  it("upload step: the same third state, not a premature 'Photo selected'", async () => {
    render(
      <AddItemModal onClose={() => {}} onSave={() => true} addStep="upload" pendingAddFile={smallPhoto()} cvUnavailable />,
    );
    expect(await screen.findByText(/Preparing preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Photo selected$/)).not.toBeInTheDocument();
  });
});

describe("AddItemModal — an un-uploadable photo is rejected AT PICK, not after the item is created", () => {
  // The convergence-round defect this closes: the modal used to say "Photo selected … it will still
  // upload" for a file whose post-downscale size exceeded the 4MB upload gate. That promise was
  // deterministically false — the friend saved, the item was created, the photo threw, and the
  // retry looped on the same unusable file. jsdom has no createImageBitmap, so prepareImageForUpload
  // falls back to the original here, which is exactly the real-world failure (old iOS Safari / a
  // decode OOM) this guards.
  function sizedFile(bytes: number, name = "huge.jpg") {
    const f = new File(["x"], name, { type: "image/jpeg" });
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  }

  it("rejects it with the screenshot remedy and does NOT leave it attached", async () => {
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(12 * 1024 * 1024)] } });

    // Told at pick time, with a remedy that actually works.
    expect(await screen.findByText(/too large to upload/i)).toHaveTextContent(
      /take a screenshot/i,
    );
    // NOT attached: no false "Photo selected", and the form is back on the photo-less footer, so a
    // save cannot silently create a photo-less item under a promise that it uploaded.
    expect(screen.queryByText(/Photo selected/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save without a photo/i })).toBeInTheDocument(),
    );
  });

  it("a normal phone photo is unaffected — it downscales and previews", async () => {
    // A working downscaler (jsdom has none, so stub it) turns a 3MB pick into ~4KB: well under the
    // gate, so it must sail through. Pins that the gate is on the POST-downscale size, not the pick.
    // Uses the shared installer rather than inline prototype assignment: `jest.restoreAllMocks()`
    // does NOT undo `X.prototype.foo = …` (and this repo's jest.config sets neither `restoreMocks`
    // nor `resetMocks`), so the inline version leaked a stubbed getContext/toBlob into every later
    // describe in this file.
    installWorkingDownscaler();
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(3 * 1024 * 1024, "phone.jpg")] } });

    expect(await screen.findByAltText("Item photo")).toBeInTheDocument();
    expect(screen.queryByText(/too large to upload/i)).not.toBeInTheDocument();
  });

  // The gate's ACCEPT side was unpinned: MAX_UPLOAD_BYTES could be lowered from 4MB to 8KB with the
  // whole suite still green (mutation-verified), because every "accepted" case stubbed a ~4KB
  // downscale — three orders of magnitude below the real limit. A silent shrink would reject
  // essentially every real phone photo with the screenshot message: direct M6 corpus yield loss on
  // the friend-critical path.
  //
  // The bracket endpoints below are ABSOLUTE on purpose. A boundary test that sizes its fixture from
  // the constant (`installWorkingDownscaler(MAX_UPLOAD_BYTES + 1)`) is self-defeating — the fixture
  // moves WITH the constant, so halving it stays green. That mistake was made and caught here; do not
  // reintroduce it. Real bytes are also mandatory: the gate reads the File's true size, so a faked
  // `size` cannot exercise it (see the preview describe below).
  it("ACCEPTS a 3MB downscale result — a cap that rejected ordinary phone photos would be a yield bug", async () => {
    // 3MB is inside the real range of a 12MP JPEG straight off iOS "Most Compatible" (2–4MB), which
    // is what the app's own HEIC advice steers friends toward. It must survive the gate.
    installWorkingDownscaler(3 * 1024 * 1024);
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The source size is faked and only has to exceed the stubbed result, so `prepareImageForUpload`
    // keeps the blob (it returns the original when the re-encode doesn't shrink).
    fireEvent.change(input, { target: { files: [sizedFile(20 * 1024 * 1024, "atcap.jpg")] } });

    expect(await screen.findByAltText("Item photo")).toBeInTheDocument();
    expect(screen.queryByText(/too large to upload/i)).not.toBeInTheDocument();
  });

  it("REJECTS a 5MB downscale result — past it, Vercel's platform body cap kills the request", async () => {
    installWorkingDownscaler(5 * 1024 * 1024);
    const { container } = render(
      <AddItemModal onClose={() => {}} onSave={() => true} initialItem={validItem} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [sizedFile(20 * 1024 * 1024, "overcap.jpg")] } });

    expect(await screen.findByText(/too large to upload/i)).toBeInTheDocument();
    expect(screen.queryByAltText("Item photo")).not.toBeInTheDocument();
  });

  it("the cap itself sits between the phone-photo floor and Vercel's ~4.5MB body ceiling", () => {
    // States the two EXTERNAL facts that constrain the value, not the value itself (a restated 4MB
    // would be a mirror). Upper: Vercel rejects request bodies over ~4.5MB at the platform edge, so
    // a larger cap hands friends an opaque non-JSON 413 instead of the screenshot remedy. Lower: an
    // ordinary phone photo must fit.
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeGreaterThanOrEqual(3 * 1024 * 1024);
  });
});

describe("AddItemModal — the §I client-state gate (a FAILED save must not discard the friend's input)", () => {
  // Lane-C finding: the `string` and `false` outcomes of the onSave contract had NO test anywhere in
  // the repo, even though this pass rewrote that union and reordered the branch chain. Deleting the
  // string branch made every failed save look like a success — modal closes, a fully-typed item is
  // destroyed, nothing said — which is the original §I defect the contract exists to prevent.
  const withPhoto = () => new File(["x"], "tee.jpg", { type: "image/jpeg" });

  it("a STRING result keeps the modal open, shows it in-modal, and preserves every field", async () => {
    const onClose = jest.fn();
    render(
      <AddItemModal
        onClose={onClose}
        onSave={() => "Item name already exists."}
        initialItem={validItem}
        pendingAddFile={withPhoto()}
        addStep="form"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^save item$/i }));

    // Shown INSIDE the modal — the page banner sits behind the z-40 overlay.
    expect(await screen.findByText(/Item name already exists\./)).toBeInTheDocument();
    // Still open, input intact: re-typing a 12-field form because of a transient 500 is the defect.
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe("Blue tee");
  });

  it("a FALSE result also keeps the modal open (silent failure, input still preserved)", async () => {
    const onClose = jest.fn();
    render(
      <AddItemModal
        onClose={onClose}
        onSave={() => false}
        initialItem={validItem}
        pendingAddFile={withPhoto()}
        addStep="form"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^save item$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^save item$/i })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe("Blue tee");
  });

  it("a failed 'Save & add another' does NOT reset the form (the next item must not eat this one)", async () => {
    render(
      <AddItemModal
        onClose={() => {}}
        onSave={() => "Server unavailable."}
        initialItem={validItem}
        pendingAddFile={withPhoto()}
        addStep="form"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    expect(await screen.findByText(/Server unavailable\./)).toBeInTheDocument();
    // The reset is reserved for SUCCESS; blanking here would lose the item that just failed to save.
    expect((screen.getByPlaceholderText(/blue denim jacket/i) as HTMLInputElement).value).toBe("Blue tee");
    expect(screen.queryByTestId("photo-warnings")).not.toBeInTheDocument();
  });
});
