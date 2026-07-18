/**
 * Client-component behavioral tests for the wardrobe add/edit modal
 * (wardrobe-ingestion-honesty-pass D5 — the two behaviors that can corrupt friend data).
 *
 * AddItemModal lives inside app/(app)/wardrobe/page.tsx; importing that module pulls in the
 * page-level Firebase client, so we mock it (the modal itself never touches Firebase — it is a
 * pure props-driven component whose only outside effect is the injected onSave).
 */
import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText(/Colors \*/i)).toBeInTheDocument();
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
