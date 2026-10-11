"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { SuggestionView } from "../WearForm";
import { canRetryPlanning, localPlanDay, planningMessage, planningRequest, planDayHint, type PlanDay } from "@/lib/outfitPlanning/client";
interface Command { planId: string; snapshotId: string; candidateId: string; plannedFor: string; timezone: string }
type PlanSource = Pick<SuggestionView, "snapshotId" | "candidateId"> & { items?: SuggestionView["items"] };
interface Props { user: User; suggestion: PlanSource; initialDay?: PlanDay }
export default function PlanForm(props: Props) {
  const { user, suggestion, initialDay } = props;
  return <PlanningForm key={`${user.uid}:${suggestion.snapshotId}:${suggestion.candidateId}:${initialDay?.plannedFor}:${initialDay?.timezone}`} {...props} />;
}
function PlanningForm({ user, suggestion, initialDay }: Props) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => initialDay ?? localPlanDay());
  const [pending, setPending] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const live = useRef(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const storageKey = `fitted:plan:${user.uid}:${suggestion.snapshotId}:${suggestion.candidateId}`;
  useEffect(() => {
    live.current = true;
    try {
      const command = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Command | null;
      const recoveredDay = planDayHint(command?.plannedFor, command?.timezone);
      if (command?.snapshotId === suggestion.snapshotId && command.candidateId === suggestion.candidateId && recoveredDay) {
        setPending(command); setDay(recoveredDay); setOpen(true);
      }
    } catch { /* Browser storage is optional. */ }
    return () => { live.current = false; };
  }, [storageKey, suggestion.snapshotId, suggestion.candidateId]);
  function clearPending() {
    setPending(null);
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
  }
  async function submit() {
    if (busyRef.current) return;
    const command = pending ?? { planId: crypto.randomUUID(), snapshotId: suggestion.snapshotId,
      candidateId: suggestion.candidateId, ...day };
    busyRef.current = true; setBusy(true); setError(""); setPending(command);
    try { sessionStorage.setItem(storageKey, JSON.stringify(command)); } catch { /* Optional storage. */ }
    try {
      const result = await planningRequest(user, "/api/plans", { method: "POST", body: JSON.stringify(command) });
      if (!live.current) return;
      setSaved(result.plannedFor); clearPending();
    } catch (cause) {
      if (!live.current) return;
      setError(planningMessage(cause));
      if (!canRetryPlanning(cause)) clearPending();
    } finally { if (live.current) { busyRef.current = false; setBusy(false); } }
  }
  if (saved) return <p role="status">Planned for {saved}. This is intent, not a wear report. <a href="/plans" className="text-blue-700 underline">View planned outfits</a></p>;
  // Fresh generated results carry a binding, not hydrated current availability.
  // The planning API always resolves that exact source and checks the current closet.
  const available = !suggestion.items || (suggestion.items.length > 0 && suggestion.items.every(item => item.availability === "available"));
  return <section className="space-y-3 border-t pt-3" aria-label="Plan this outfit">
    <button type="button" className="text-blue-700 underline" onClick={() => setOpen(value => !value)}>Plan this outfit</button>
    {open && <>
      <p>Set this outfit aside for a day. Planning does not mean you liked it or wore it.</p>
      {initialDay && <p>You can change this day. Saving adds a separate plan; existing plans stay unchanged.</p>}
      {day.plannedFor && day.plannedFor < localPlanDay(day.timezone).plannedFor && <p>That planned day has passed. Choose today or a future day for a new plan.</p>}
      {!suggestion.items && <p>Current piece availability is checked when you save.</p>}
      {!available && <p>Some pieces are currently unavailable. Update your closet or choose another proposal before planning.</p>}
      {(available || pending) && <>
        <label className="block">Plan for <input aria-label="Plan for" type="date" value={day.plannedFor} disabled={busy || !!pending}
          onChange={event => setDay({ ...day, plannedFor: event.target.value })} className="ml-2 rounded border p-2" /></label>
        <p className="text-sm text-slate-600">Day in {day.timezone}. No reminder is scheduled.</p>
        <button type="button" disabled={busy || !day.plannedFor} onClick={() => void submit()} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
          {busy ? "Saving plan…" : pending ? "Retry same plan" : "Save plan"}
        </button>
        {pending && <p>A previous request may already have saved. Discarding clears this browser request; check Planned outfits before planning again.</p>}
        {pending && <button type="button" disabled={busy} onClick={() => { clearPending(); setError(""); }} className="ml-3 underline">Discard pending request</button>}
      </>}
      {error && <p role="alert">{error}</p>}
      <a href="/plans" className="inline-block text-blue-700 underline">View planned outfits</a>
    </>}
  </section>;
}
