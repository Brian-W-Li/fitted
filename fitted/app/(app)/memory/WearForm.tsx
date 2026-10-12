"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { displayRoleLabel } from "@/lib/outfitRoles";
import { normalizeLayerRole } from "@/lib/layerRole";

export interface MemoryItem {
  itemId: string; name: string; clothingType: string | null; availability: "available" | "unavailable" | "missing";
  changed: boolean; imageUrl?: string | null; role?: string;
}
export interface ExperienceView {
  experienceId: string; lifecycle: "active" | "retracted" | "erased"; currentRevision: number;
  state: { occurredOn: string; timezone: string; context: { rawOccasion: string; source: "user" | "suggestion"; confirmed: boolean }; outcome: "worked" | "change_next_time" | "unknown"; compositionStatus?: "as_shown" | "changed" };
  sourceAvailable: boolean; source: { snapshotId: string; candidateId: string } | null; items: MemoryItem[]; sourceItems?: MemoryItem[];
}
export interface SuggestionView { shownVariationAllowed?: boolean; snapshotId: string; candidateId: string; suggestionContext: string; weatherContext?: string | null; items: MemoryItem[]; styleMove?: { oneSentence?: string } | null }
export interface ClosetChoice { id: string; name: string; clothingType?: string; layerRole?: string; isAvailable?: boolean }

function localDate(timezone?: string) {
  const date = new Date();
  const zone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  return { occurredOn: `${value("year")}-${value("month")}-${value("day")}`, timezone: zone };
}
function errorText(code: string, status: number) {
  if (status === 409) return "This report changed elsewhere. Reload to see the latest version.";
  if (status === 410) return "This report or account was removed.";
  if (status === 429) return "Your wear memory is full. You can still correct or erase existing reports.";
  if (status === 400) return code;
  return "Couldn't confirm the save. Your report is held for a safe retry.";
}
type Pending = { path: string; method: "POST" | "PATCH"; body: Record<string, unknown> };

export default function WearForm({ user, suggestion, experience, closet = [], onSaved, onStarted }: {
  user: User; suggestion?: SuggestionView; experience?: ExperienceView; closet?: ClosetChoice[]; onSaved?: () => void; onStarted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => localDate().occurredOn);
  const [timezone, setTimezone] = useState(() => experience?.state.timezone ?? localDate().timezone);
  const [context, setContext] = useState("");
  const [confirmSuggestion, setConfirmSuggestion] = useState(false);
  const [outcome, setOutcome] = useState<"worked" | "change_next_time" | "unknown">("unknown");
  const [changedMode, setChangedMode] = useState(experience?.state.compositionStatus === "changed");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (experience?.items ?? suggestion?.items ?? []).map(item => item.itemId));
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const source = suggestion ?? (experience ? { snapshotId: experience.source?.snapshotId ?? "", candidateId: experience.source?.candidateId ?? "", suggestionContext: "", items: experience.sourceItems ?? experience.items } : undefined);
  const membershipLocked = !!experience && !source?.items.length;
  const storageKey = `fitted:wear:${user.uid}:${experience?.experienceId ?? `${source?.snapshotId}:${source?.candidateId}`}`;
  const live = useRef(false);
  const busyRef = useRef(false);
  const currentKey = useRef(storageKey);
  currentKey.current = storageKey;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  function clearPending() {
    setPending(null);
    try { localStorage.removeItem(storageKey); } catch { /* Storage cannot invalidate a server acknowledgement. */ }
  }
  useEffect(() => {
    if (experience) {
      setDate(experience.state.occurredOn);
      setTimezone(experience.state.timezone);
      setContext(experience.state.context.source === "user" ? experience.state.context.rawOccasion : "");
      setConfirmSuggestion(experience.state.context.source === "suggestion" && experience.state.context.confirmed);
      setOutcome(experience.state.outcome);
      setChangedMode(experience.state.compositionStatus === "changed");
      setSelectedIds(experience.items.map(item => item.itemId));
    }
    try {
      const savedPending = localStorage.getItem(storageKey);
      if (savedPending) { setPending(JSON.parse(savedPending) as Pending); setOpen(true); }
    } catch { /* Storage is optional. In-memory retries still use the same payload. */ }
  }, [storageKey, experience]);
  if (!source || (experience && experience.lifecycle !== "active")) return null;
  const create = !experience;
  const suggestedSituation = suggestion?.suggestionContext ?? (experience?.state.context.source === "suggestion" ? experience.state.context.rawOccasion : "");
  async function submit() {
    if (busyRef.current || !source) return;
    const command: Pending = pending ?? {
      path: create ? "/api/experiences" : `/api/experiences/${experience!.experienceId}`,
      method: create ? "POST" : "PATCH",
      body: {
        ...(create ? { experienceId: crypto.randomUUID(), snapshotId: source.snapshotId, candidateId: source.candidateId } : { expectedPreviousRevision: experience!.currentRevision }),
        operationId: crypto.randomUUID(), occurredOn: date, timezone,
        context: context.trim() || experience?.state.context.source === "user" || (experience && !experience.source && confirmSuggestion !== experience.state.context.confirmed) ? { kind: "user", text: context } : { kind: "suggestion", confirmed: confirmSuggestion },
        outcome, compositionStatus: changedMode ? "changed" : "as_shown",
        ...(changedMode ? { memberItemIds: selectedIds } : {}),
      },
    };
    const submittedKey = storageKey;
    setPending(command);
    try { localStorage.setItem(storageKey, JSON.stringify(command)); } catch { /* Retry remains stable during this session. */ }
    onStarted?.(); busyRef.current = true; setBusy(true); setError("");
    try {
      const token = await user.getIdToken();
      if (!live.current || currentKey.current !== submittedKey) return;
      const response = await fetch(command.path, { method: command.method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(command.body) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!live.current || currentKey.current !== submittedKey) return;
      if (!response.ok) {
        setError(errorText(result.error ?? "Could not save report", response.status));
        if ([400, 404, 409, 410, 413, 415, 429].includes(response.status)) { clearPending(); }
        return;
      }
      clearPending(); setSaved(true); onSaved?.();
    } catch { if (live.current && currentKey.current === submittedKey) setError("Couldn't confirm the save. Your report is held for a safe retry."); }
    finally { if (live.current && currentKey.current === submittedKey) { busyRef.current = false; setBusy(false); } }
  }
  if (saved) return <p className="text-sm text-emerald-700" role="status">Wear report saved. Find or correct it in Wear memory.</p>;
  return <div className="mt-3 border-t border-slate-200 pt-3 text-sm">
    <button type="button" className="font-medium text-blue-700 underline" onClick={() => setOpen(!open)}>{open ? "Close wear form" : create ? "Report what I wore" : "Correct wear report"}</button>
    {open && <div className="mt-3 space-y-3 rounded-lg bg-white p-3 border border-slate-200">
      <p className="text-slate-700">Report only pieces you actually wore. The shown suggestion stays as the source; a like or saved idea is not wear.</p>
      <fieldset disabled={!!pending} className="space-y-2"><legend className="font-medium">What did you actually wear?</legend>
        <label className="mr-4"><input type="radio" name={`composition-${storageKey}`} checked={!changedMode} disabled={membershipLocked && experience?.state.compositionStatus === "changed"} onChange={() => { setChangedMode(false); setSelectedIds(source.items.map(item => item.itemId)); }} /> Same as suggested</label>
        <label><input type="radio" name={`composition-${storageKey}`} checked={changedMode} disabled={!source.items.length && experience?.state.compositionStatus !== "changed"} onChange={() => setChangedMode(true)} /> I changed some pieces</label>
      </fieldset>
      {changedMode && <div className="space-y-2 rounded border p-2">
        <p className="font-medium">Reported outfit</p>
        {!!source.items.length && <div><p>Suggested pieces — select only those you wore:</p>{source.items.map(item =>
          <label key={item.itemId} className="mr-3 inline-block"><input type="checkbox" checked={selectedIds.includes(item.itemId)}
            disabled={!!pending || (item.availability === "missing" && !selectedIds.includes(item.itemId))}
            onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, item.itemId] : ids.filter(id => id !== item.itemId))} /> {item.name}{item.role === "mid_layer" ? ` (${displayRoleLabel(item.clothingType, item.role)})` : ""}{item.availability === "missing" ? " (removed from closet; cannot add to a changed report)" : ""}</label>)}</div>}
        <label className="block">Add a piece from your closet <select aria-label="Add a piece from your closet" value={addId} disabled={!!pending || membershipLocked}
          onChange={event => { const id = event.target.value; setAddId(""); if (id) setSelectedIds(ids => ids.includes(id) ? ids : [...ids, id]); }} className="ml-2 rounded border p-1">
          <option value="">Choose a piece</option>{closet.filter(item => !selectedIds.includes(item.id)).map(item =>
            <option key={item.id} value={item.id}>{item.name}{item.clothingType === "top" && normalizeLayerRole(item.layerRole) === "mid" ? " (mid-layer eligible)" : ""}{item.isAvailable === false ? " (unavailable now)" : ""}</option>)}</select></label>
        <ul aria-label="Actual pieces" className="list-disc pl-5">{selectedIds.map(id => {
          const item = source.items.find(piece => piece.itemId === id) ?? experience?.items.find(piece => piece.itemId === id);
          const closetItem = closet.find(piece => piece.id === id);
          return <li key={id}>{item?.name ?? closetItem?.name ?? "Removed closet piece"}{item?.role === "mid_layer" ? ` (${displayRoleLabel(item.clothingType, item.role)})` : ""}
            {!source.items.some(piece => piece.itemId === id) && <button type="button" disabled={!!pending || membershipLocked} className="ml-2 text-red-700 underline" onClick={() => setSelectedIds(ids => ids.filter(value => value !== id))}>Remove</button>}</li>;
        })}</ul>
        {!source.items.length && <p className="text-amber-700">The original suggestion is unavailable. You can correct other details while keeping these reported pieces.</p>}
        <p className="text-slate-600">Keep at least one suggested piece. Choose a dress or a top and bottom, with optional outer layer and shoes. For separates, you can add one top marked as a mid layer over a base top; two mid layers are not supported. Currently unavailable closet pieces can still describe a past wear.</p>
      </div>}
      <label className="block">Date worn <input aria-label="Date worn" type="date" value={date} max={localDate(timezone).occurredOn} disabled={!!pending} onChange={e => setDate(e.target.value)} className="ml-2 border rounded p-1" /></label>
      <label className="block">Actual situation <input aria-label="Actual situation" type="text" maxLength={200} value={context} disabled={!!pending} onChange={e => setContext(e.target.value)} placeholder="e.g. class" className="ml-2 border rounded p-1" /></label>
      {!!suggestedSituation && <label className="block"><input type="checkbox" checked={confirmSuggestion} disabled={!!context.trim() || !!pending} onChange={e => setConfirmSuggestion(e.target.checked)} /> I wore it for the suggested situation: {suggestedSituation}</label>}
      <label className="block">How did it go? <select aria-label="How did it go?" value={outcome} disabled={!!pending} onChange={e => setOutcome(e.target.value as typeof outcome)} className="ml-2 border rounded p-1"><option value="unknown">I don&apos;t know yet</option><option value="worked">Worked for me</option><option value="change_next_time">I&apos;d change it next time</option></select></label>
      {experience && !experience.source && <p className="text-amber-700">The original suggestion is unavailable. A confirmed situation stays recorded unless you change it.</p>}
      {!context.trim() && !confirmSuggestion && <p className="text-slate-500">Situation stays unconfirmed. You can add it later.</p>}
      {pending && <p className="text-amber-700">A previous save may have reached the server. Retry keeps the same report and operation IDs.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button type="button" disabled={busy || !date || (changedMode && !selectedIds.length)} onClick={() => void submit()} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : pending ? "Retry saved report" : create ? "Save wear report" : "Save correction"}</button>
    </div>}
  </div>;
}
