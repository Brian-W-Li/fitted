"use client";

import { auth } from "@/lib/firebaseClient";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import RedirectIfAuthenticated from "@/app/(app)/RedirectIfAuthenticated";

function normalizeAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = /auth\/[a-z-]+/.exec(message)?.[0];

  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase Auth, use localhost or add this domain in Firebase Console";
  }
  if (code === "auth/popup-blocked") {
    return "Popup was blocked by browser, please allow popups and try again";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Sign-in popup was closed before completing login";
  }

  return message || "Sign-in failed";
}

export default function SigninPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGoogle() {
    try {
      setLoading(true);
      setError(null);

      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Sync user to MongoDB (handles both existing and new users)
      // If user is new, Firebase creates account and we sync to MongoDB
      const syncResponse = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid: user.uid,
          email: user.email || "",
          displayName: user.displayName || undefined,
          photoURL: user.photoURL || undefined,
        }),
      });

      if (!syncResponse.ok) {
        const errorData = await syncResponse.json().catch(() => ({}));
        const detail =
          typeof errorData?.error === "string"
            ? errorData.error
            : "Failed to sync user to database";
        throw new Error(detail);
      }

      const data = await syncResponse.json();
      
      // Store userId for convenience
      if (data.userId) {
        localStorage.setItem("userId", data.userId);
      }

      router.push("/dashboard");
    } catch (e) {
      console.error("Signin error:", e);
      setError(normalizeAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <RedirectIfAuthenticated>
    <div className="flex min-h-screen items-center justify-center bg-white">
      <main className="w-full max-w-md px-6 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-900 mb-2">Sign in</h1>
          <p className="text-sm text-slate-600">
            Sign in to access your wardrobe and outfit recommendations
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-300 rounded-lg font-medium text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            "Signing in..."
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {error && (
          <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-600">
            New User?{" "}
            <Link
              href="/signup"
              className="font-semibold text-slate-900 hover:underline"
            >
              Sign Up
            </Link>
          </p>
        </div>
      </main>
    </div>
    </RedirectIfAuthenticated>
  );
}
