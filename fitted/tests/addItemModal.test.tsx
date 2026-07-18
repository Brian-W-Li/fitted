/**
 * Client-component behavioral tests for the wardrobe add/edit modal
 * (wardrobe-ingestion-honesty-pass D5 — the two behaviors that can corrupt friend data).
 *
 * AddItemModal lives inside app/(app)/wardrobe/page.tsx; importing that module pulls in the
 * page-level Firebase client, so we mock it (the modal itself never touches Firebase — it is a
 * pure props-driven component whose only outside effect is the injected onSave).
 */
import { render, screen } from "@testing-library/react";

jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AddItemModal } = require("@/app/(app)/wardrobe/page") as typeof import("@/app/(app)/wardrobe/page");

describe("AddItemModal — harness smoke", () => {
  it("renders the confirm/save form with the required fields", () => {
    render(<AddItemModal onClose={() => {}} onSave={() => true} title="Add item" />);
    expect(screen.getByRole("button", { name: /save item/i })).toBeInTheDocument();
    expect(screen.getByText(/Colors \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Category \*/i)).toBeInTheDocument();
  });
});
