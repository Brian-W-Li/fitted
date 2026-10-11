"use client";

import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { finishAccountDeletion } from "@/lib/accountDeletionClient";
import { PENDING_DELETE_MESSAGE } from "@/lib/accountDeletionMessage";

/** A closed account can resume its already-requested erasure without entering the app. */
export default function DeletionPending({ user }: { user: FirebaseUser }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/account", {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setError(response.status === 401
          ? "Your sign-in has expired. Contact support to finish the pending deletion."
          : "Cleanup couldn't finish yet. Please try again.");
        return;
      }
      await finishAccountDeletion(user.uid);
    } catch (failure) {
      const code = failure && typeof failure === "object" && "code" in failure ? failure.code : null;
      const expired = typeof code === "string" && ["auth/user-token-expired", "auth/user-disabled", "auth/user-not-found", "auth/invalid-user-token"].includes(code);
      setError(expired ? "Your sign-in has expired. Contact support to finish the pending deletion."
        : "Cleanup couldn't finish yet. Please try again.");
    } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="max-w-md text-slate-600">{PENDING_DELETE_MESSAGE}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void retry()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {busy ? "Finishing deletion…" : "Finish deletion"}
      </button>
    </div>
  );
}
