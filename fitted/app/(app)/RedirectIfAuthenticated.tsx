"use client";

import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Redirects to /dashboard when a user is already signed in. Use on landing, signin, and signup pages
 * so logged-in users go straight to the app.
 *
 * §I client-state gate — fix redirect-before-sync: a brand-new Google user can reach this component
 * before their Mongo row exists (the sign-in handler's `/api/auth/sync` may not have finished), which
 * would land them on /dashboard whose API calls then 404. We therefore ensure the (idempotent) sync
 * has run — presenting the verified ID token — BEFORE redirecting, so the app never loads against a
 * not-yet-synced identity.
 */
export default function RedirectIfAuthenticated({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (!cancelled) setChecking(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            email: user.email || "",
            displayName: user.displayName || undefined,
            photoURL: user.photoURL || undefined,
          }),
        });
      } catch {
        // A failed sync must not trap the user on the auth page — AuthGate re-runs the idempotent
        // sync on every app load, so the row is repaired on arrival.
      }
      if (!cancelled) router.replace("/dashboard");
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
