"use client";

import { useEffect, useId, useRef, useState } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";

export type GarmentPhoto = { src: string; label: string };

/** Current photos only. Saved proposal photos continue using their immutable snapshot viewer. */
export function PhotoDialog({ photos, initialIndex = 0, name, onClose }: {
  photos: GarmentPhoto[]; initialIndex?: number; name: string; onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [failed, setFailed] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const selectedIndex = Math.min(index, photos.length - 1);
  const photo = photos[selectedIndex];
  return <dialog ref={dialog} aria-labelledby={titleId}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-auto rounded-xl bg-white p-4 text-slate-900 backdrop:bg-black/70"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "ArrowRight") { event.preventDefault(); setIndex((Math.min(index, photos.length - 1) + 1) % photos.length); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((Math.min(index, photos.length - 1) + photos.length - 1) % photos.length); }
      if (event.key === "Tab") {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const current = controls.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    }}>
    <div className="flex items-start justify-between gap-4">
      <h2 id={titleId} className="font-semibold">Current photo: {name}</h2>
      <button type="button" onClick={onClose} className="rounded border px-3 py-2">Close photo</button>
    </div>
    {failed.includes(photo.src)
      ? <p className="my-8 text-center text-slate-500">Photo unavailable</p>
      : <img src={photo.src} alt={`Enlarged ${photo.label.toLowerCase()} of ${name}`}
        className="mx-auto mt-3 max-h-[65dvh] max-w-full object-contain"
        onError={() => setFailed(old => [...old, photo.src])} />}
    {photos.length > 1 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Current photo views">
      {photos.map((entry, i) => <button key={entry.src} type="button" aria-pressed={selectedIndex === i}
        className="rounded border px-3 py-2 aria-pressed:bg-slate-200" onClick={() => setIndex(i)}>{entry.label}</button>)}
    </div>}
    <p className="mt-3 text-sm text-slate-600">{photo.label}. Current garment photo; saved suggestions keep their original main photo.</p>
  </dialog>;
}

export function CurrentGarmentGallery({ imagePath, imageUrl, supplementalImages = [], name }: {
  imagePath?: string; imageUrl?: string; supplementalImages?: string[]; name: string;
}) {
  const photos: GarmentPhoto[] = [
    ...(resolveImageSrc(imageUrl || imagePath) ? [{ src: resolveImageSrc(imageUrl || imagePath)!, label: "Main photo" }] : []),
    ...supplementalImages.flatMap((ref, i) => {
      const src = resolveImageSrc(ref);
      return src ? [{ src, label: `Additional view ${i + 1}` }] : [];
    }),
  ];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const selectedIndex = Math.min(index, photos.length - 1);
  const photo = photos[selectedIndex];
  if (!photo) return <p className="flex min-h-40 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">No photo</p>;
  return <div className="space-y-3">
    {failed.includes(photo.src)
      ? <p className="flex min-h-40 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">Photo unavailable</p>
      : <button type="button" aria-label={`Enlarge current photo of ${name}`} className="block w-full rounded-lg border p-1"
        onClick={() => setOpen(true)}>
        <img src={photo.src} alt={name} className="max-h-[36rem] w-full object-contain"
          onError={() => setFailed(old => [...old, photo.src])} />
      </button>}
    {photos.length > 1 && <div className="flex flex-wrap gap-2" aria-label="Current photo views">
      {photos.map((entry, i) => <button key={entry.src} type="button" aria-label={`Select ${entry.label.toLowerCase()}`}
        aria-pressed={selectedIndex === i} className="rounded border px-2 py-1 text-sm aria-pressed:bg-slate-200"
        onClick={() => setIndex(i)}>{entry.label}</button>)}
    </div>}
    <p className="text-xs text-slate-500">{photo.label}. Tap to enlarge.</p>
    {open && <PhotoDialog photos={photos} initialIndex={selectedIndex} name={name} onClose={() => setOpen(false)} />}
  </div>;
}
