"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedbackConcern, FeedbackReasonValue, FeedbackScope, PerItemFeedbackValue } from "@/lib/feedbackTypes";
import type { EnrichData } from "@/lib/useDislikeEnrich";

interface FeedbackItem { itemId: string; name?: string }
interface FeedbackOutfit {
  displayItems: FeedbackItem[];
  feedbackReason?: FeedbackReasonValue;
  perItemFeedback?: PerItemFeedbackValue[];
}
const SCOPES: { value: FeedbackScope; label: string }[] = [
  { value: "item", label: "This item" }, { value: "outfit", label: "This combination" }, { value: "request", label: "Not for today" },
];
const CONCERNS: { value: FeedbackConcern; label: string }[] = [
  { value: "fit", label: "Fit" }, { value: "formality", label: "Formality" }, { value: "style", label: "Style" }, { value: "other", label: "Other" },
];
export function hasFeedbackDetails(outfit: Pick<FeedbackOutfit, "feedbackReason" | "perItemFeedback">): boolean {
  const reason = outfit.feedbackReason;
  return Boolean(reason?.scope || reason?.rawText?.trim() || reason?.codes?.length || outfit.perItemFeedback?.length);
}
export function FeedbackNote({ reason, items }: { reason?: FeedbackReasonValue; items: FeedbackItem[] }) {
  if (!reason?.scope) return null;
  const scope = reason.scope === "item" ? items.find(item => item.itemId === reason.itemId)?.name ?? "This item"
    : reason.scope === "outfit" ? "This combination" : "This occasion";
  const concern = CONCERNS.find(entry => entry.value === reason.concern)?.label;
  return <div className="my-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 break-words">
    <p className="font-medium">Your note · {scope}{concern ? ` · ${concern}` : ""}</p>
    {reason.rawText && <p className="mt-1 whitespace-pre-wrap">{reason.rawText}</p>}
  </div>;
}

/** A declaration about an exact shown item, combination or saved request. Never an implicit vote or exclusion. */
export default function FeedbackDetails({ outfit, occasion, onClose, onSave }: {
  outfit: FeedbackOutfit; occasion: string; onClose: () => void; onSave: (data: EnrichData) => void;
}) {
  const initial = outfit.feedbackReason;
  const [scope, setScope] = useState<FeedbackScope>(initial?.scope ?? "request");
  const [itemId, setItemId] = useState(initial?.itemId ?? "");
  const [concern, setConcern] = useState<FeedbackConcern | undefined>(initial?.concern);
  const [rawText, setRawText] = useState(initial?.rawText ?? "");
  const scopeWasExplicit = useRef(Boolean(initial?.scope));
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  const selectScope = (next: FeedbackScope) => {
    scopeWasExplicit.current = true;
    setScope(next);
    if (next !== "item" && concern === "fit") setConcern(undefined);
  };
  const selectConcern = (next: FeedbackConcern) => {
    setConcern(next);
    if (next === "fit") setScope("item");
    else if (next === "formality" && !scopeWasExplicit.current) setScope("request");
  };
  const codes = initial?.codes ?? [];
  const perItemFeedback = outfit.perItemFeedback ?? [];
  const hasInput = Boolean(concern || rawText.trim() || codes.length || perItemFeedback.length);
  const valid = hasInput && (scope !== "item" || outfit.displayItems.some(item => item.itemId === itemId));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="feedback-details-heading"
      className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 space-y-4"
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, [tabindex="0"]') ?? [])];
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="feedback-details-heading" className="text-xl font-semibold">What felt off?</h2>
        <button ref={close} type="button" onClick={onClose} aria-label="Close details" className="rounded p-2 hover:bg-slate-100">✕</button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="What this note applies to">
        {SCOPES.map(entry => <button type="button" key={entry.value} aria-pressed={scope === entry.value} onClick={() => selectScope(entry.value)}
          className={`rounded-lg border px-3 py-2 text-sm ${scope === entry.value ? "bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>{entry.label}</button>)}
      </div>
      {scope === "request" && <p className="text-sm text-slate-600">For this request{occasion ? `: ${occasion}` : "."}</p>}
      {scope === "item" && <label className="block text-sm font-medium">Which item?
        <select aria-label="Which item?" value={itemId} onChange={event => setItemId(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 p-2">
          <option value="">Choose a piece</option>
          {outfit.displayItems.map(item => <option key={item.itemId} value={item.itemId}>{item.name ?? "Item"}</option>)}
        </select>
      </label>}
      <div className="flex flex-wrap gap-2" aria-label="What bothered you">
        {CONCERNS.map(entry => <button type="button" key={entry.value} aria-pressed={concern === entry.value} onClick={() => selectConcern(entry.value)}
          className={`rounded-full border px-3 py-1.5 text-sm ${concern === entry.value ? "bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>{entry.label}</button>)}
      </div>
      <label className="block text-sm font-medium">A quick note (optional)
        <textarea aria-label="A quick note (optional)" value={rawText} maxLength={500} onChange={event => setRawText(event.target.value)} rows={2}
          placeholder={concern === "fit" ? "This shirt is too big for me." : "What would you change?"}
          className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-normal" />
      </label>
      {(codes.length > 0 || perItemFeedback.length > 0) && <p className="text-xs text-slate-600">Your earlier details are kept. Clear details removes those too.</p>}
      <p className="text-xs text-slate-500">Your like or dislike stays unchanged. A concern excludes this reaction from experimental taste learning. You can include it again in History. A note never bans a piece.</p>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {hasFeedbackDetails(outfit) && <button type="button" onClick={() => onSave({ codes: [], perItemFeedback: [] })} className="mr-auto rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">Clear details</button>}
        <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Cancel</button>
        <button type="button" disabled={!valid} onClick={() => onSave({ codes: [...codes], perItemFeedback: perItemFeedback.map(item => ({ ...item })),
          reason: { scope, concern: concern ?? "other", ...(scope === "item" ? { itemId } : {}), ...(rawText.trim() ? { rawText } : {}) } })}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40">Save details</button>
      </div>
    </div>
  </div>;
}
