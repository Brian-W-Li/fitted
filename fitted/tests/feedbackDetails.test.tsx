import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackDetails from "@/app/(app)/dashboard/FeedbackDetails";

const outfit = { displayItems: [{ itemId: "shirt", name: "White polo" }, { itemId: "pants", name: "Blue trousers" }] };
it("defaults a formality concern to the captured request and never fabricates exclusions", async () => {
  const save = jest.fn();
  render(<FeedbackDetails outfit={outfit} occasion="Class tomorrow" onClose={jest.fn()} onSave={save} />);
  await userEvent.click(screen.getByRole("button", { name: "Formality" }));
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(save).toHaveBeenCalledWith({ codes: [], perItemFeedback: [], reason: { scope: "request", concern: "formality" } });
});
it("honors an explicit combination scope and prevents a fit concern from leaking out of item scope", async () => {
  const save = jest.fn();
  render(<FeedbackDetails outfit={outfit} occasion="Class" onClose={jest.fn()} onSave={save} />);
  await userEvent.click(screen.getByRole("button", { name: "This combination" }));
  await userEvent.click(screen.getByRole("button", { name: "Formality" }));
  expect(screen.getByRole("button", { name: "This combination" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(screen.getByRole("button", { name: "This item" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Which item?" }), "shirt");
  await userEvent.click(screen.getByRole("button", { name: "Not for today" }));
  expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Style" }));
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(save.mock.calls[0][0].reason).toEqual({ scope: "request", concern: "style" });
});
it("preserves existing legacy reasons and per-item notes unless explicitly cleared", async () => {
  const save = jest.fn();
  const old = { ...outfit, feedbackReason: { codes: ["not_me"], rawText: "Earlier explanation" },
    perItemFeedback: [{ itemId: "shirt", disliked: true, notes: "Earlier detail" }] };
  const { unmount } = render(<FeedbackDetails outfit={old} occasion="Class" onClose={jest.fn()} onSave={save} />);
  expect(screen.getByRole("textbox", { name: "A quick note (optional)" })).toHaveValue("Earlier explanation");
  await userEvent.click(screen.getByRole("button", { name: "This combination" }));
  await userEvent.click(screen.getByRole("button", { name: "Style" }));
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(save.mock.calls[0][0]).toMatchObject({ codes: ["not_me"], perItemFeedback: old.perItemFeedback, reason: { rawText: "Earlier explanation" } });
  unmount();
  render(<FeedbackDetails outfit={old} occasion="Class" onClose={jest.fn()} onSave={save} />);
  await userEvent.click(screen.getByRole("button", { name: "Clear details" }));
  expect(save.mock.calls[1][0]).toEqual({ codes: [], perItemFeedback: [] });
});
