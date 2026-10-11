import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockParams = new URLSearchParams("itemId=garment");
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

type Item = { id: string; name: string; category: string; colors: string[]; fit: string; size: string; seasons: string[]; occasions: string[];
  imagePath?: string; imageUrl?: string; supplementalImages: string[] };
const base: Item = { id: "garment", name: "Green shirt", category: "top", colors: ["green"], fit: "", size: "", seasons: [], occasions: [],
  imagePath: "mongo:main", supplementalImages: [] };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) }) as Response;
const rejected = (error: string, status = 422) => ({ ok: false, status, json: async () => ({ error }) }) as Response;
const photo = (name = "detail.jpg") => new File([name], name, { type: "image/jpeg" });
const region = () => screen.getByRole("region", { name: "Current garment" });
const photoRequests = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith("/image"));
const itemPosts = () => (global.fetch as jest.Mock).mock.calls.filter(([url, init]) => url === "/api/wardrobe" && init?.method === "POST");

function api({ initial = base, upload, patch, reloadFails = false, cv = false }: {
  initial?: Item | null; upload?: (body: FormData, item: Item) => Response | "lost" | undefined;
  patch?: (item: Item) => Item; reloadFails?: boolean; cv?: boolean;
} = {}) {
  let item: Item | null = initial ? { ...initial, supplementalImages: [...initial.supplementalImages] } : null;
  let reads = 0;
  let nextImage = 0;
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/cv/status") return ok({ available: cv });
    if (path === "/api/cv/infer") return ok({ category: { value: "top" }, type: { value: "shirt" }, colors: [{ value: "green" }], cropped_image_base64: btoa("cropped main") });
    if (path === "/api/wardrobe" && (!init?.method || init.method === "GET")) {
      reads++;
      if (reloadFails && reads > 1) return rejected("Reload failed", 503);
      return ok({ items: item ? [item] : [] });
    }
    if (path === "/api/wardrobe" && init?.method === "POST") {
      item = { ...JSON.parse(String(init.body)), id: "garment", supplementalImages: [] };
      return ok({ item });
    }
    if (path === "/api/wardrobe/garment" && init?.method === "PATCH") {
      item = patch ? patch(item!) : { ...item!, ...JSON.parse(String(init.body)) };
      return ok({ item });
    }
    if (path.endsWith("/image") && init?.method === "POST") {
      const body = init.body as FormData;
      const custom = upload?.(body, item!);
      if (custom === "lost") throw new Error("Connection lost");
      if (custom) return custom;
      const ref = `mongo:new-${++nextImage}`;
      if (body.get("view") === "supplemental") {
        const previous = body.get("imageRef");
        item!.supplementalImages = previous ? item!.supplementalImages.map(old => old === previous ? ref : old) : [...item!.supplementalImages, ref];
      } else { item!.imagePath = ref; delete item!.imageUrl; }
      return ok(item);
    }
    if (path.endsWith("/image") && init?.method === "DELETE") {
      const body = JSON.parse(String(init.body));
      if (body.view === "primary") { delete item!.imagePath; delete item!.imageUrl; }
      else item!.supplementalImages = item!.supplementalImages.filter(ref => ref !== body.imageRef);
      return ok(item);
    }
    return rejected("Unexpected route", 404);
  }) as unknown as typeof fetch;
  return { current: () => item, reads: () => reads };
}
async function edit() {
  await within(region()).findByRole("heading", { name: /green shirt/i });
  await userEvent.click(within(region()).getByRole("button", { name: "Edit this garment" }));
}
async function chooseExtra(number: number, file = photo()) {
  // Picking awaits preparation before committing a draft. Flush that continuation explicitly
  // rather than racing a one-second polling deadline during the integrated regression pass.
  await act(async () => {
    fireEvent.change(screen.getByLabelText(`Additional view ${number}`), { target: { files: [file] } });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: `Replace additional view ${number}` })).toBeEnabled());
}
async function save() {
  await userEvent.click(screen.getByRole("button", { name: /^Save item$/i }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Save item$/i })).not.toBeInTheDocument());
}
beforeEach(() => { mockParams = new URLSearchParams("itemId=garment"); });

it("adds and inspects an optional current view in StrictMode with dialog keyboard and focus behavior", async () => {
  api();
  render(<StrictMode><WardrobePage /></StrictMode>);
  await edit();
  await chooseExtra(1);
  await save();
  const selector = within(region()).getByRole("button", { name: "Select additional view 1" });
  await userEvent.click(selector);
  expect(within(region()).getByRole("img", { name: "Green shirt" })).toHaveAttribute("src", "/api/images/new-1");
  const enlarge = within(region()).getByRole("button", { name: "Enlarge current photo of Green shirt" });
  await userEvent.click(enlarge);
  const dialog = screen.getByRole("dialog", { name: "Current photo: Green shirt" });
  const close = within(dialog).getByRole("button", { name: "Close photo" });
  expect(close).toHaveFocus();
  await userEvent.tab();
  expect(within(dialog).getByRole("button", { name: "Main photo" })).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(close).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(within(dialog).getByRole("button", { name: "Additional view 1" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/images/main");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(enlarge).toHaveFocus();
});

it("replaces one supplemental reference and removes another without changing the main photo", async () => {
  const server = api({ initial: { ...base, supplementalImages: ["mongo:front", "mongo:back"] } });
  render(<WardrobePage />);
  await edit();
  await chooseExtra(1, photo("new-front.jpg"));
  await userEvent.click(screen.getByRole("button", { name: "Remove additional view 2" }));
  await save();
  expect(server.current()?.imagePath).toBe("mongo:main");
  expect(server.current()?.supplementalImages).toEqual(["mongo:new-1"]);
  expect((photoRequests()[0][1].body as FormData).get("imageRef")).toBe("mongo:front");
  expect(JSON.parse(photoRequests()[1][1].body)).toEqual({ view: "supplemental", imageRef: "mongo:back" });
});

it("removes a legacy main photo by exact reference while keeping the supplemental view", async () => {
  const server = api({ initial: { ...base, imagePath: undefined, imageUrl: "/api/images/legacy", supplementalImages: ["mongo:back"] } });
  render(<WardrobePage />);
  await within(region()).findByRole("heading", { name: "Green shirt" });
  expect(within(region()).getByRole("img")).toHaveAttribute("src", "/api/images/legacy");
  await edit();
  await userEvent.click(screen.getByRole("button", { name: "Remove main photo" }));
  await save();
  expect(JSON.parse(photoRequests()[0][1].body)).toEqual({ view: "primary", imageRef: "/api/images/legacy" });
  expect(server.current()?.supplementalImages).toEqual(["mongo:back"]);
  expect(within(region()).getByRole("img")).toHaveAttribute("src", "/api/images/back");
});

it("respects an authoritative metadata response whose concurrent main removal omitted imagePath", async () => {
  api({ patch: item => { const copy = { ...item }; delete copy.imagePath; return copy; } });
  render(<WardrobePage />);
  await edit();
  await save();
  expect(within(region()).getByText("No photo")).toBeInTheDocument();
  expect(photoRequests()).toHaveLength(0);
});

it("reconciles a committed append whose response was lost and never automatically appends it twice", async () => {
  const server = api({ upload: (_body, item) => { item.supplementalImages = ["mongo:committed"]; return "lost"; } });
  render(<WardrobePage />);
  await edit();
  await chooseExtra(1);
  await chooseExtra(2, photo("detail-2.jpg"));
  await save();
  expect(server.reads()).toBe(2);
  expect(photoRequests()).toHaveLength(1);
  expect(screen.getByTestId("photo-failures")).toHaveTextContent("could not confirm whether it saved");
  expect(screen.getByTestId("photo-failures")).toHaveTextContent("Additional view 2: not attempted");
  await userEvent.click(within(region()).getByRole("button", { name: "Select additional view 1" }));
  expect(within(region()).getByRole("img")).toHaveAttribute("src", "/api/images/committed");
  await edit();
  expect(screen.getByRole("button", { name: "Remove additional view 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add additional view 2" })).toBeInTheDocument();
  expect(photoRequests()).toHaveLength(1);
});

it("requires a wardrobe reload before editing again when an uncertain append cannot be reconciled", async () => {
  api({ upload: () => "lost", reloadFails: true });
  render(<WardrobePage />);
  await edit();
  await chooseExtra(1);
  await save();
  expect(screen.getByTestId("photo-failures")).toHaveTextContent("Reload your wardrobe before editing photos again");
  expect(within(region()).getByRole("button", { name: "Edit this garment" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.queryByRole("button", { name: /^Save item$/i })).not.toBeInTheDocument();
  expect(photoRequests()).toHaveLength(1);
});

it("creates once, names saved and failed views, and retries a known failed view by editing the same item", async () => {
  mockParams = new URLSearchParams();
  let extras = 0;
  let rejectSecond = true;
  api({ initial: null, upload: body => {
    if (body.get("view") === "supplemental" && ++extras === 2 && rejectSecond) return rejected("Invalid photo bytes");
  } });
  const { container } = render(<WardrobePage />);
  await userEvent.click(await screen.findByRole("button", { name: /\+ Add item/i }));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [photo("main.jpg")] } });
  await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await userEvent.type(screen.getByPlaceholderText(/blue denim jacket/i), "Green shirt");
  fireEvent.change(screen.getByDisplayValue("Select a category…"), { target: { value: "top" } });
  await chooseExtra(1, photo("back.jpg"));
  await chooseExtra(2, photo("tag.jpg"));
  await save();
  expect(itemPosts()).toHaveLength(1);
  expect(screen.getByTestId("photo-failures")).toHaveTextContent("Photo changes saved: Main photo, Additional view 1");
  expect(screen.getByTestId("photo-failures")).toHaveTextContent("Additional view 2: failed — Invalid photo bytes");
  rejectSecond = false;
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await chooseExtra(2, photo("tag-fixed.jpg"));
  await save();
  expect(itemPosts()).toHaveLength(1);
  expect(photoRequests()).toHaveLength(4);
  expect(screen.getAllByText("Green shirt")).toHaveLength(1);
});

it("preserves the add-flow CV-cropped primary and sends a supplemental pick without another CV call", async () => {
  mockParams = new URLSearchParams();
  api({ initial: null, cv: true });
  const { container } = render(<WardrobePage />);
  await userEvent.click(await screen.findByRole("button", { name: /\+ Add item/i }));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [photo("main-original.jpg")] } });
  await userEvent.click(await screen.findByRole("button", { name: "Analyze photo" }));
  await waitFor(() => expect(screen.getByPlaceholderText(/blue denim jacket/i)).toHaveValue("Shirt"));
  await chooseExtra(1, photo("back-original.jpg"));
  await save();
  const primary = photoRequests()[0][1].body as FormData;
  const extra = photoRequests()[1][1].body as FormData;
  expect((primary.get("file") as File).name).toBe("cv-cropped.png");
  expect((extra.get("file") as File).name).toBe("back-original.jpg");
  expect(extra.get("view")).toBe("supplemental");
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === "/api/cv/infer")).toHaveLength(1);
});

it("rejects a supplemental HEIC selection while preserving the stored photo", async () => {
  api({ initial: { ...base, supplementalImages: ["mongo:back"] } });
  render(<WardrobePage />);
  await edit();
  fireEvent.change(screen.getByLabelText("Additional view 1"), { target: { files: [new File(["x"], "back.heic", { type: "image/heic" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("iPhone photos are often HEIC");
  await save();
  expect(photoRequests()).toHaveLength(0);
  await userEvent.click(within(region()).getByRole("button", { name: "Select additional view 1" }));
  expect(within(region()).getByRole("img")).toHaveAttribute("src", "/api/images/back");
});

it("does not show old-owner photo state when an in-flight append completes after account switch", async () => {
  let finish: () => void = () => {};
  const pending = new Promise<void>(resolve => { finish = resolve; });
  api();
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/image")) { await pending; return ok({ ...base, supplementalImages: ["mongo:old-owner"] }); }
    return originalFetch(url as RequestInfo, init);
  }) as unknown as typeof fetch;
  render(<WardrobePage />);
  await edit();
  await chooseExtra(1);
  await userEvent.click(screen.getByRole("button", { name: /^Save item$/i }));
  await waitFor(() => expect(photoRequests()).toHaveLength(1));
  api({ initial: null });
  act(() => mockAuthCallback({ uid: "new-owner", getIdToken: async () => "new-token" }));
  await act(async () => { finish(); await pending; });
  await within(region()).findByText(/This garment is not in your current wardrobe/);
  expect(screen.queryByRole("button", { name: "Select additional view 1" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("photo-failures")).not.toBeInTheDocument();
});


it("resizes a supplemental pick while preserving the whole selected content and validates the resized size", async () => {
  api();
  const originalCreate = globalThis.createImageBitmap;
  const originalContext = HTMLCanvasElement.prototype.getContext;
  const originalBlob = HTMLCanvasElement.prototype.toBlob;
  const draw = jest.fn();
  const decode = jest.fn(async () => ({ width: 4000, height: 3000, close: jest.fn() }));
  globalThis.createImageBitmap = decode as unknown as typeof createImageBitmap;
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: draw })) as unknown as typeof originalContext;
  HTMLCanvasElement.prototype.toBlob = function (callback) { callback(new Blob(["resized-whole-photo"], { type: "image/jpeg" })); };
  try {
    render(<WardrobePage />);
    await edit();
    await chooseExtra(1, new File([new Uint8Array(5 * 1024 * 1024)], "back-large.jpg", { type: "image/jpeg" }));
    await save();
    expect(decode).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 960);
    expect((photoRequests()[0][1].body as FormData).get("file")).toHaveProperty("size", 19);
    expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === "/api/cv/infer")).toHaveLength(0);
  } finally {
    globalThis.createImageBitmap = originalCreate;
    HTMLCanvasElement.prototype.getContext = originalContext;
    HTMLCanvasElement.prototype.toBlob = originalBlob;
  }
});

it("keeps other current views inspectable after one supplemental image fails to load", async () => {
  api({ initial: { ...base, supplementalImages: ["mongo:bad", "mongo:back"] } });
  render(<WardrobePage />);
  await within(region()).findByRole("heading", { name: "Green shirt" });
  await userEvent.click(within(region()).getByRole("button", { name: "Select additional view 1" }));
  fireEvent.error(within(region()).getByRole("img"));
  expect(within(region()).getByText("Photo unavailable")).toBeInTheDocument();
  await userEvent.click(within(region()).getByRole("button", { name: "Select additional view 2" }));
  expect(within(region()).getByRole("img")).toHaveAttribute("src", "/api/images/back");
});
