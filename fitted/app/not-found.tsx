// F9 — a mistyped or dead URL otherwise shows Next's default 404. A friend gets a calm way back.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">404</p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        That page doesn&apos;t exist (or moved). Let&apos;s get you back to your outfits.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        Go home
      </Link>
    </div>
  );
}
