import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SavedGarmentList from "@/app/ui/SavedGarmentList";
import type { MemoryItem } from "@/app/(app)/memory/WearForm";
const item: MemoryItem = { itemId: "650000000000000000000002", name: "Green tee", clothingType: "top", imageUrl: "mongo:650000000000000000000003", availability: "available", changed: false };
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
it("opens the saved image without writes, closes on Escape and restores focus/scroll", () => {
  const fetch = jest.fn(); global.fetch = fetch;
  document.body.style.overflow = "auto";
  render(<SavedGarmentList items={[item]} />);
  const trigger = screen.getByRole("button", { name: "Enlarge saved photo of Green tee" });
  trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Saved photo: Green tee" })).toBeInTheDocument();
  expect(screen.getByAltText("Enlarged saved photo of Green tee")).toHaveAttribute("src", "/api/images/650000000000000000000003");
  expect(document.body.style.overflow).toBe("hidden");
  const close = screen.getByRole("button", { name: "Close photo" });
  close.focus(); fireEvent.keyDown(close, { key: "Tab" }); expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true }); expect(close).toHaveFocus();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("auto"); expect(fetch).not.toHaveBeenCalled();
});
it("links the exact unavailable owned garment but leaves a removed garment unlinked", () => {
  render(<SavedGarmentList items={[{ ...item, availability: "unavailable", changed: true }, { ...item, itemId: "other", name: "Removed tee", availability: "missing" }]} />);
  expect(screen.getByRole("link", { name: "View current garment: Green tee" })).toHaveAttribute("href", "/wardrobe?itemId=650000000000000000000002");
  expect(screen.queryByRole("link", { name: "View current garment: Removed tee" })).not.toBeInTheDocument();
  expect(screen.getByText("closet details changed")).toBeInTheDocument();
});
it("preserves names when absent, unsafe or broken photos cannot be inspected", () => {
  render(<SavedGarmentList items={[{ ...item, imageUrl: null }, { ...item, itemId: "two", name: "Other tee", imageUrl: "javascript:bad" }, { ...item, itemId: "three", name: "Broken tee" }]} />);
  expect(screen.getAllByText("No saved photo")).toHaveLength(2);
  fireEvent.error(screen.getByAltText("Broken tee"));
  expect(screen.getByText("Saved photo unavailable")).toBeInTheDocument();
  expect(screen.getByText("Broken tee")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enlarge saved photo of Broken tee" })).not.toBeInTheDocument();
});
it("restores scrolling when a refreshed/redacted proposal unmounts an open viewer", () => {
  document.body.style.overflow = "scroll";
  const view = render(<SavedGarmentList items={[item]} />);
  fireEvent.click(screen.getByRole("button", { name: "Enlarge saved photo of Green tee" }));
  view.unmount(); expect(document.body.style.overflow).toBe("scroll");
});
