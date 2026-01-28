"use client";

import { auth } from "@/lib/firebaseClient";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    try {
      setSigningOut(true);
      await signOut(auth);
      localStorage.removeItem("userId");
      router.push("/signin");
    } catch (error) {
      console.error("Error signing out:", error);
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <p className="mt-2 text-sm text-slate-600">
          Welcome back! You are signed in.
        </p>
      </div>
      <button
        onClick={handleLogout}
        disabled={signingOut}
        className="w-fit rounded-lg bg-slate-900 px-6 py-2 text-white font-medium transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {signingOut ? "Signing out..." : "Log Out"}
      </button>
    </div>
  );
}
