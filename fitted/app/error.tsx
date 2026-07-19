"use client";

// F9 — a runtime error in any route otherwise shows Next's raw error screen (stack trace in dev, a
// blank white page in prod). A friend gets a calm, branded recovery instead: retry, or go home.
import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console/monitoring; the friend never sees the raw message.
    console.error("Unhandled app error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        That&apos;s on us, not you. Try again — if it keeps happening, it usually clears up in a minute.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
