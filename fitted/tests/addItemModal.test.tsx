/**
 * Client-component behavioral tests for the wardrobe add/edit modal
 * (wardrobe-ingestion-honesty-pass D5 — the two behaviors that can corrupt friend data).
 *
 * AddItemModal lives inside app/(app)/wardrobe/page.tsx; importing that module pulls in the
 * page-level Firebase client, so we mock it (the modal itself never touches Firebase — it is a
 * pure props-driven component whose only outside effect is the injected onSave).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
