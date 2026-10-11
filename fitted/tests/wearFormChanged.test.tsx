import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { User } from "firebase/auth";
import WearForm, { type SuggestionView } from "@/app/(app)/memory/WearForm";

const user = { uid: "wear-owner", getIdToken: jest.fn().mockResolvedValue("token") } as unknown as User;
const top = "650000000000000000000001";
const oldBottom = "650000000000000000000002";
const newBottom = "650000000000000000000003";
const suggestion: SuggestionView = { snapshotId: "650000000000000000000004", candidateId: "c0", suggestionContext: "Class",
  items: [
    { itemId: top, name: "Green shirt", clothingType: "top", availability: "available", changed: false },
    { itemId: oldBottom, name: "Old jeans", clothingType: "bottom", availability: "available", changed: false },
  ] };

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn()
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222") });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("reports only the confirmed changed pieces while retaining the original suggestion ID", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ acknowledgedRevision: 1 }) });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  render(<WearForm user={user} suggestion={suggestion} closet={[{ id: newBottom, name: "Black trousers", clothingType: "bottom", isAvailable: true }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Report what I wore" }));
  fireEvent.click(screen.getByRole("radio", { name: "I changed some pieces" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Old jeans" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a piece from your closet" }), { target: { value: newBottom } });
  expect(screen.getByRole("list", { name: "Actual pieces" })).toHaveTextContent("Black trousers");
  fireEvent.change(screen.getByRole("textbox", { name: "Actual situation" }), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByRole("button", { name: "Save wear report" }));
  await screen.findByText(/Wear report saved/);
  const request = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(request).toMatchObject({ snapshotId: suggestion.snapshotId, candidateId: "c0", compositionStatus: "changed",
    memberItemIds: [top, newBottom], context: { kind: "user", text: "Dinner" } });
  expect(request.memberItemIds).not.toContain(oldBottom);
});
