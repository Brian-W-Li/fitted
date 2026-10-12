import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({ onAuthStateChanged: () => () => {} }));
import { AddItemModal } from "@/app/(app)/wardrobe/WardrobeClient";
const item = { name: "Green shirt", category: "top", subCategory: "shirt", colors: ["green"],
  pattern: "striped", fit: "Regular", size: "M", notes: "Keep this personal note", seasons: [], occasions: [], isAvailable: true };
it("preserves collapsed pattern/fit and hidden size/notes when saving an edit", async () => {
  const save = jest.fn(async () => undefined);
  render(<AddItemModal initialItem={item} existingImagePath="mongo:synthetic-photo" onClose={jest.fn()} onSave={save} />);
  await userEvent.click(screen.getByRole("button", { name: "Save item" }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ pattern: "striped", fit: "Regular", size: "M", notes: item.notes }), null, expect.anything());
});
it("clears pattern/fit explicitly while preserving hidden details and showing truthful guidance", async () => {
  const save = jest.fn(async () => undefined);
  render(<AddItemModal initialItem={item} existingImagePath="mongo:synthetic-photo" onClose={jest.fn()} onSave={save} />);
  await userEvent.click(screen.getByText("More details (optional)", { exact: true }));
  expect(screen.getByText(/Pattern and fit help the stylist/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Pattern", { exact: true }), "");
  await userEvent.selectOptions(screen.getByLabelText("Fit", { exact: true }), "");
  await userEvent.click(screen.getByRole("button", { name: "Save item" }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ pattern: "", fit: "", size: "M", notes: item.notes }), null, expect.anything());
});
