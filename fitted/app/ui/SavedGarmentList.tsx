"use client";

import { useEffect, useId, useRef, useState } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";
import type { MemoryItem } from "../(app)/memory/WearForm";

function SavedPhoto({ image, name }: { image: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const opener = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  if (failed) return <span className="text-sm text-slate-500">Saved photo unavailable</span>;
  return <>
    <button ref={trigger} type="button" aria-label={`Enlarge saved photo of ${name}`}
      className="shrink-0 rounded border border-slate-200 p-1 focus-visible:outline-2 focus-visible:outline-blue-700"
      onClick={() => setOpen(true)}>
      <img src={image} alt={name} className="h-20 w-20 rounded object-contain" onError={() => { setOpen(false); setFailed(true); }} />
    </button>
    {open && <dialog ref={dialog} aria-labelledby={titleId}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-auto rounded-xl bg-white p-4 text-slate-900 backdrop:bg-black/70"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onKeyDown={event => {
        // This viewer has one control. Keep Tab inside rather than cycling through browser chrome,
        // whose window-focus event refreshes and unmounts historical proposals.
        if (event.key === "Tab") { event.preventDefault(); dialog.current?.querySelector("button")?.focus(); }
      }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="font-semibold">Saved photo: {name}</h2>
        <button type="button" autoFocus onClick={() => setOpen(false)} className="rounded border px-3 py-2">Close photo</button>
      </div>
      <img src={image} alt={`Enlarged saved photo of ${name}`} className="mx-auto mt-3 max-h-[65dvh] max-w-full object-contain"
        onError={() => { setOpen(false); setFailed(true); }} />
      <p className="mt-3 text-sm text-slate-600">Photo referenced by this suggestion. Current closet details may have changed.</p>
    </dialog>}
  </>;
}

/** Inspect snapshot photo references without replacing them with current closet images. */
export default function SavedGarmentList({ items }: { items: MemoryItem[] }) {
  return <ul className="space-y-3">{items.map(item => {
    const image = resolveImageSrc(item.imageUrl);
    return <li key={item.itemId} className="flex flex-wrap items-center gap-3">
      {image ? <SavedPhoto key={image} image={image} name={item.name} /> : <span className="text-sm text-slate-500">No saved photo</span>}
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{item.name}</p>
        {item.availability !== "available" && <p className="text-sm text-amber-700">{item.availability === "missing" ? "removed from closet" : "currently unavailable"}</p>}
        {item.changed && <p className="text-sm text-slate-500">closet details changed</p>}
        {item.availability !== "missing" && <a href={`/wardrobe?itemId=${encodeURIComponent(item.itemId)}`}
          aria-label={`View current garment: ${item.name}`} className="text-sm text-blue-700 underline">View current garment</a>}
      </div>
    </li>;
  })}</ul>;
}
