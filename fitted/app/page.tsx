export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
      <main className="w-full max-w-xl px-6 py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold uppercase tracking-widest text-white">
          F
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
          Outfit recommender
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Sign in to save your wardrobe and get quick outfit suggestions.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a
            className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 sm:w-auto"
            href="/signup"
          >
            Continue with Google
          </a>
          <a className="text-sm font-semibold text-slate-900" href="/signin">
            Sign in
          </a>
        </div>
      </main>
    </div>
  );
}
