import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "firebase/auth";
import DeletionPending from "@/app/(app)/DeletionPending";
jest.mock("@/lib/accountDeletionClient", () => ({ finishAccountDeletion: jest.fn() }));

it.each(["auth/user-token-expired", "auth/user-disabled", "auth/user-not-found", "auth/invalid-user-token"])("directs %s to recovery when token refresh itself fails", async code => {
  global.fetch = jest.fn();
  const user = { uid: "u1", getIdToken: jest.fn().mockRejectedValue({ code }) } as unknown as User;
  render(<DeletionPending user={user} />);
  await userEvent.click(screen.getByRole("button", { name: "Finish deletion" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/contact support/i);
  expect(global.fetch).not.toHaveBeenCalled();
});
