"use client";

import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureSessionCookie } from "@/lib/sessionCookie";

/** What the repair-net sync attempt concluded. Never throws — the branch decides admission. */
type SyncOutcome = "ok" | "auth_rejected" | "unreachable";

export default function AuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "trouble">("loading");
  const userRef = useRef<FirebaseUser | null>(null);

  // Repair net for a failed first-sign-in sync: without a Mongo User row every API in the app
  // 404s ("User not found") and nothing else retries — so re-run the idempotent sync (a findOne
  // on the warm path) alongside the session-cookie mint. The OUTCOME is checked (DEFECTS-H88):
  // admitting a user whose sync failed used to render a full app in which every call then failed,
  // presenting a database outage as a broken login.
  const admit = useCallback(async (user: FirebaseUser) => {
    setStatus("loading");
    const syncUser = async (): Promise<SyncOutcome> => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            displayName: user.displayName || undefined,
            photoURL: user.photoURL || undefined,
          }),
        });
        if (res.ok) return "ok";
        // 401 = the TOKEN was rejected (e.g. revoked after an account deletion) — a genuine
        // credential problem, the one case where signing out is the honest remedy.
        if (res.status === 401) return "auth_rejected";
        // Any other failure (503/500) is the server or database, not the person — retryable.
        return "unreachable";
      } catch {
        return "unreachable"; // network failure — same retryable class
      }
    };
    // Ensure the session cookie exists BEFORE rendering owner-only images (§I). Kept parallel to
    // the sync, exactly as before — the gate decision reads only the sync outcome.
    const [outcome] = await Promise.all([syncUser(), ensureSessionCookie(user)]);
    if (outcome === "auth_rejected") {
      // Sign out so the auth listener routes to /signin — pushing /signin while Firebase still
      // reports a user would bounce straight back here via RedirectIfAuthenticated.
      await signOut(auth).catch(() => {});
      return;
    }
    setStatus(outcome === "ok" ? "ready" : "trouble");
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      userRef.current = user;
      if (user) {
        await admit(user);
      } else {
        router.push("/signin");
      }
    });

    return () => unsubscribe();
  }, [router, admit]);

  if (status === "trouble") {
    // A database/server fault must not read as a login problem (DEFECTS-H88): say what it is —
    // temporary, not the friend's fault, fixed by trying again — and offer the retry.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-md text-slate-600">
          We&apos;re having trouble reaching your closet right now. It&apos;s a temporary problem on
          our side — your sign-in and your data are fine.
        </p>
        <button
          type="button"
          onClick={() => userRef.current && void admit(userRef.current)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
