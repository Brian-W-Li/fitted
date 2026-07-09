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
        // Ensure the session cookie exists BEFORE rendering owner-only images (§I). Best-effort +
        // freshness-gated, so only the first app load per session pays a mint round-trip.
        await ensureSessionCookie(user);
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
