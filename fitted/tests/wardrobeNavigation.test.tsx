import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockParams = new URLSearchParams();
let mockAuthCallback: (user: unknown) => void;
jest.mock("next/navigation", () => ({ useSearchParams: () => mockParams }));
jest.mock("@/lib/firebaseClient", () => ({ auth: {} }));
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    mockAuthCallback = callback;
    callback({ uid: "owner", getIdToken: async () => "token" });
    return () => {};
  },
}));
import WardrobePage from "@/app/(app)/wardrobe/page";

const target = {
  id: "exact-id", name: "Current green shirt", category: "top", subCategory: "shirt",
  colors: ["green", "white"], isAvailable: false, imagePath: "mongo:photo-id",
  seasons: [], occasions: [], fit: "", size: "",
};
const other = { ...target, id: "other-id", colors: ["blue"] };
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function mockCloset(items: unknown[] = [target, other]) {
  global.fetch = jest.fn(async () => ok({ items })) as unknown as typeof fetch;
}
function details() { return screen.getByRole("region", { name: "Current garment" }); }
function mutations() {
  return (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
}
beforeEach(() => {
  mockParams = new URLSearchParams("itemId=exact-id");
  mockCloset();
});

it("shows the exact unavailable item read-only with its current photo and colors, independently of filters", async () => {
  render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  expect(details()).toHaveTextContent("green, white");
  expect(details()).not.toHaveTextContent("blue");
  expect(details()).toHaveTextContent("Currently unavailable for recommendations");
  expect(within(details()).getByRole("img", { name: target.name })).toHaveAttribute("src", "/api/images/photo-id");
  expect(details()).toHaveFocus();
  expect(screen.queryByRole("button", { name: /^save item$/i })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  fireEvent.change(screen.getByPlaceholderText("Search wardrobe by item name"), { target: { value: "nonmatching" } });
  await userEvent.click(screen.getByRole("button", { name: "Bottoms" }));
  expect(screen.getByText("No items match your search.")).toBeInTheDocument();
  expect(within(details()).getByRole("heading", { name: target.name })).toBeInTheDocument();
});
it("opens the existing edit form only after an explicit click", async () => {
  render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  await userEvent.click(within(details()).getByRole("button", { name: "Edit this garment" }));
  expect(await screen.findByRole("button", { name: /^save item$/i })).toBeInTheDocument();
  expect(screen.getByDisplayValue(target.name)).toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});
it.each(["missing-id", "foreign-id", "", "invalid/?id"])("does not substitute another item for absent or invalid ID %s", async (id) => {
  mockParams = new URLSearchParams({ itemId: id });
  render(<WardrobePage />);
  await within(details()).findByText(/This garment is not in your current wardrobe/);
  expect(within(details()).queryByRole("img")).not.toBeInTheDocument();
  expect(within(details()).queryByRole("button", { name: "Edit this garment" })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});
it("rejects ambiguous repeated itemId values", async () => {
  mockParams = new URLSearchParams("itemId=exact-id&itemId=other-id");
  render(<WardrobePage />);
  await within(details()).findByText(/This garment is not in your current wardrobe/);
});
it("waits for the owner closet before claiming a garment is missing", async () => {
  let release: (response: Response) => void = () => {};
  global.fetch = jest.fn(() => new Promise<Response>((resolve) => { release = resolve; })) as unknown as typeof fetch;
  render(<WardrobePage />);
  expect(details()).toHaveTextContent("Loading this garment from your wardrobe");
  expect(details()).not.toHaveTextContent("not in your current wardrobe");
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => release(ok({ items: [target] })));
  expect(await within(details()).findByRole("heading", { name: target.name })).toBeInTheDocument();
});
it("distinguishes a failed closet load from a missing garment", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: "Load failed" }) })) as unknown as typeof fetch;
  render(<WardrobePage />);
  await within(details()).findByText(/Could not load this garment/);
  expect(details()).not.toHaveTextContent("not in your current wardrobe");
});
it("removes the old owner's details when the signed-in account changes", async () => {
  render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  mockCloset([]);
  act(() => mockAuthCallback({ uid: "new-owner", getIdToken: async () => "new-token" }));
  expect(within(details()).queryByRole("heading", { name: target.name })).not.toBeInTheDocument();
  await within(details()).findByText(/This garment is not in your current wardrobe/);
});
it("keeps the normal wardrobe when no itemId is supplied", async () => {
  mockParams = new URLSearchParams();
  mockCloset([target]);
  render(<WardrobePage />);
  await screen.findByText(target.name);
  expect(screen.queryByRole("region", { name: "Current garment" })).not.toBeInTheDocument();
});
it("updates the exact detail when the query changes without reopening the page", async () => {
  const { rerender } = render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  mockParams = new URLSearchParams("itemId=other-id");
  rerender(<WardrobePage />);
  expect(details()).toHaveTextContent("blue");
  expect(details()).not.toHaveTextContent("green, white");
  expect(mutations()).toHaveLength(0);
});
it("shows an honest no-photo fallback", async () => {
  mockCloset([{ ...target, imagePath: undefined }]);
  render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  expect(within(details()).getByText("No photo")).toBeInTheDocument();
  expect(within(details()).queryByRole("img")).not.toBeInTheDocument();
});

it("keeps current details readable when its photo fails", async () => {
  render(<WardrobePage />);
  await within(details()).findByRole("heading", { name: target.name });
  fireEvent.error(within(details()).getByRole("img", { name: target.name }));
  expect(within(details()).getByText("Photo unavailable")).toBeInTheDocument();
  expect(within(details()).getByRole("heading", { name: target.name })).toBeInTheDocument();
});
