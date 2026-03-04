import Link from "next/link";
import RedirectIfAuthenticated from "@/app/(app)/RedirectIfAuthenticated";

export default function LandingPage() {
  return (
    <RedirectIfAuthenticated>
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-slate-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-32 h-64 w-64 rounded-full bg-slate-200/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-slate-300/20 blur-3xl" />

      <section className="mx-auto max-w-6xl px-6 py-6">
        <header className="flex items-center justify-between">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white/80 px-3 py-1 text-3xl font-extrabold text-slate-900 shadow-sm">
            Fitted
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/signin"
              className="rounded-lg border border-slate-300 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Get started
            </Link>
          </div>
        </header>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-10 md:grid-cols-2 md:py-16">
        <div>
          <p className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            Smart Wardrobe Assistant
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Plan better outfits from the clothes you already own
          </h1>
          <p className="mt-5 max-w-xl text-base text-slate-600">
            Fitted helps you organize wardrobe items, auto-extract attributes from photos,
            and get outfit recommendations you can improve with feedback
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <h2 className="text-lg font-semibold text-slate-900">What you can do</h2>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-medium text-slate-900">Build a smart digital wardrobe</p>
              <p className="mt-1">Add items manually or upload photos to auto-fill attributes like type, colors, fit, and formality</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-medium text-slate-900">Personalized outfit recommendations</p>
              <p className="mt-1">Get outfit suggestions and let the ML model learn from your like/dislike feedback over time</p>
            </div>
          </div>
        </div>
      </section>
    </main>
    </RedirectIfAuthenticated>
  );
}
