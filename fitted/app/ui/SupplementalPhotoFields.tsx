"use client";

import { useEffect, useRef, useState } from "react";
import { resolveImageSrc } from "@/lib/imageUrl";
import { MAX_PICK_BYTES, MAX_UPLOAD_BYTES, TOO_LARGE_TO_UPLOAD_MSG, UNSUPPORTED_IMAGE_MSG, prepareImageForUpload } from "@/lib/garmentPhotoUpload";
import type { SupplementalPhotoDraft } from "@/lib/garmentPhotoChanges";
import { PhotoDialog } from "./CurrentGarmentGallery";

function SupplementalPhotoField({ value, number, onChange, disabled, onBusy }: {
  value: SupplementalPhotoDraft; number: number; onChange: (value: SupplementalPhotoDraft) => void;
  disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [enlarged, setEnlarged] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setPreview(null);
    if (!value.file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(value.file);
    return () => { reader.onload = null; reader.abort(); };
  }, [value.file]);
  async function pick(file?: File) {
    if (!file) return;
    const request = ++selection.current;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError(UNSUPPORTED_IMAGE_MSG); return; }
    if (file.size > MAX_PICK_BYTES) { setError(TOO_LARGE_TO_UPLOAD_MSG); return; }
    onBusy(true);
    try {
      // Supplemental views retain the user's content; resizing never calls computer vision.
      const prepared = await prepareImageForUpload(file);
      if (!mounted.current || request !== selection.current) return;
      if (prepared.size > MAX_UPLOAD_BYTES) { setError(TOO_LARGE_TO_UPLOAD_MSG); return; }
      onChange({ ...value, file: prepared, removed: false });
    } catch {
      if (mounted.current && request === selection.current) setError("This photo could not be prepared. Choose it again or try a screenshot.");
    } finally { if (mounted.current && request === selection.current) onBusy(false); }
  }
  const label = `Additional view ${number}`;
  const src = value.file ? preview : value.removed ? null : resolveImageSrc(value.imageRef);
  const present = !!value.file || (!!value.imageRef && !value.removed);
  return <div className="rounded-lg border border-slate-200 p-3 space-y-2">
    <p className="text-sm font-medium">{label} <span className="font-normal text-slate-500">(optional)</span></p>
    {src && !failed.includes(src) ? <button type="button" disabled={disabled} aria-label={`Enlarge ${label.toLowerCase()}`} onClick={() => setEnlarged(true)}>
      <img src={src} alt={label} className="max-h-32 rounded object-contain" onError={() => setFailed(old => [...old, src])} />
    </button> : src && failed.includes(src) ? <p className="text-xs text-slate-500">Photo unavailable</p> : present ? <p className="text-xs text-slate-500">Photo selected: {value.file?.name ?? label}</p> : null}
    <input ref={input} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" aria-label={label}
      disabled={disabled} onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={disabled} className="underline disabled:opacity-50" onClick={() => input.current?.click()}>
        {present ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
      </button>
      {present && <button type="button" disabled={disabled} className="text-red-700 disabled:opacity-50"
        onClick={() => { selection.current++; onBusy(false); onChange({ imageRef: value.imageRef, removed: true }); }}>
        Remove {label.toLowerCase()}
      </button>}
      {value.removed && value.imageRef && <button type="button" disabled={disabled}
        onClick={() => onChange({ imageRef: value.imageRef })}>Keep {label.toLowerCase()}</button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    {enlarged && src && <PhotoDialog photos={[{ src, label }]} name={label} onClose={() => setEnlarged(false)} />}
  </div>;
}

export default function SupplementalPhotoFields({ value, onChange, disabled, onBusy }: {
  value: SupplementalPhotoDraft[]; onChange: (value: SupplementalPhotoDraft[]) => void;
  disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const busy = useRef([false, false]);
  return <section className="space-y-3" aria-label="Additional garment views">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Additional views</h3>
    <p className="text-xs text-slate-500">Up to two optional photos, such as the back or a detail. View them on this garment; suggestions use the main photo.</p>
    {[0, 1].map(index => <SupplementalPhotoField key={index} number={index + 1} value={value[index] ?? {}}
      disabled={disabled} onChange={draft => onChange([0, 1].map(i => i === index ? draft : value[i] ?? {}))}
      onBusy={pending => { busy.current[index] = pending; onBusy(busy.current.some(Boolean)); }} />)}
  </section>;
}
