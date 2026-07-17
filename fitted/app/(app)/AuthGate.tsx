"use client";

import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ensureSessionCookie } from "@/lib/sessionCookie";

export default function AuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Repair net for a failed first-sign-in sync: without a Mongo User row every API in the
        // app 404s ("User not found") and nothing else retries — so re-run the idempotent sync
        // (a findOne on the warm path) alongside the session-cookie mint. Best-effort: a sync
        // failure here must not blank the app; the pages surface their own API errors.
        const syncUser = async () => {
          try {
            const token = await user.getIdToken();
            await fetch("/api/auth/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                displayName: user.displayName || undefined,
                photoURL: user.photoURL || undefined,
              }),
            });
          } catch {
            // best-effort
          }
        };
        // Ensure the session cookie exists BEFORE rendering owner-only images (§I).
        await Promise.all([syncUser(), ensureSessionCookie(user)]);
        setIsSignedIn(true);
      } else {
        router.push("/signin");
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
