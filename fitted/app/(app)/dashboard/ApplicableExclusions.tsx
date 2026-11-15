"use client";

import type { ExclusionPreview } from "@/lib/useExclusionPreview";

/** Read-only request preview; dispatch/ref freezing and all writes belong to the parent. */
export default function ApplicableExclusions({ preview, scopeLabel }: { preview: ExclusionPreview; scopeLabel?: string }) {
  if (!preview.pending && !preview.error && !preview.entries.length) return null;
  return <section aria-label="Saved exclusions for this request" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
    <h4 className="font-medium">Saved exclusions for this request</h4>
    {scopeLabel && <p className="mt-1 break-words text-xs text-slate-600">{scopeLabel}</p>}
    {preview.pending ? <p role="status" className="mt-2">Loading saved exclusions…</p>
      : preview.error ? <div role="alert" className="mt-2"><p>{preview.error}</p><button type="button" className="mt-2 rounded border border-slate-300 px-3 py-2" onClick={preview.retry}>Retry exclusions</button></div>
        : <><ul className="mt-2 space-y-1">{preview.entries.map((entry, index) => <li key={index} className="break-words">
          {entry.kind === "item" ? "One piece" : "Exact outfit"}: {entry.names.join(" + ")}
        </li>)}</ul><p className="mt-2 text-xs text-slate-600">Only an exact complete outfit set is left out. Its pieces can still appear in other outfits.</p></>}
  </section>;
}
