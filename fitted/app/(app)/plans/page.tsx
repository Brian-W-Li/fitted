"use client";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import type { SuggestionView } from "../memory/WearForm";
import SavedGarmentList from "@/app/ui/SavedGarmentList";
import { suggestionLink } from "@/lib/suggestionLink";
import { canRetryPlanning, localPlanDay, planningMessage, planningRequest } from "@/lib/outfitPlanning/client";
export interface PlanView { planId: string; revision: number; plannedFor: string; timezone: string; suggestion: SuggestionView | null }
function PlanCard({ user, plan, onChanged }: { user: User; plan: PlanView; onChanged: () => void }) {
  const [date, setDate] = useState(plan.plannedFor);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<{ method: "PATCH" | "DELETE"; body?: string } | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const storageKey = `fitted:plan-edit:${user.uid}:${plan.planId}`;
  useEffect(() => {
    try { const command = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); if (command) { setPending(command); if (command.body) setDate(JSON.parse(command.body).plannedFor); } }
    catch { /* Optional storage. */ }
  }, [storageKey]);
  function clearPending() { setPending(null); try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ } }
  async function mutate(method: "PATCH" | "DELETE") {
    if (busyRef.current) return;
    const command = pending ?? { method, ...(method === "PATCH" ? { body: JSON.stringify({ operationId: crypto.randomUUID(),
      expectedRevision: plan.revision, plannedFor: date, timezone: plan.timezone }) } : {}) };
    busyRef.current = true; setBusy(true); setError(""); setPending(command);
    try { sessionStorage.setItem(storageKey, JSON.stringify(command)); } catch { /* Optional storage. */ }
    try {
      await planningRequest(user, `/api/plans/${plan.planId}`, command);
      if (!live.current) return;
      clearPending(); onChanged();
    } catch (cause) {
      if (!live.current) return;
      setError(planningMessage(cause));
      if (!canRetryPlanning(cause)) clearPending();
    } finally { if (live.current) { busyRef.current = false; setBusy(false); } }
  }
  return <article className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="font-semibold">Planned for {plan.plannedFor}</h2><p className="text-sm text-slate-600">Day in {plan.timezone}. Planned, not reported worn.</p>
    {plan.plannedFor < localPlanDay(plan.timezone).plannedFor && <p>This planned day has passed. It has not been counted as wear.</p>}
    {plan.suggestion ? <>
      <p>Suggested situation: {plan.suggestion.suggestionContext || "Unknown"}</p>
      <SavedGarmentList items={plan.suggestion.items} />
      {plan.suggestion.styleMove?.oneSentence && <p>{plan.suggestion.styleMove.oneSentence}</p>}
      <a href={suggestionLink(plan.suggestion, { plannedFor: plan.plannedFor, timezone: plan.timezone })} className="inline-block text-blue-700 underline">Open proposal / report actual wear</a>
      <label className="block">Change planned day <input aria-label="Change planned day" type="date" value={date} disabled={busy || !!pending}
        onChange={event => setDate(event.target.value)} className="ml-2 rounded border p-2" /></label>
      <button disabled={busy || !!pending || !date || date === plan.plannedFor} onClick={() => void mutate("PATCH")} className="text-blue-700 underline disabled:opacity-50">Save new date</button>
    </> : <p>This proposal is no longer available. Its source may have changed or been removed. You can remove the plan.</p>}
    <button disabled={busy || !!pending} onClick={() => void mutate("DELETE")} className="ml-3 text-red-700 underline disabled:opacity-50">Remove plan</button>
    {pending && <><p>A previous change may already have saved. Retry confirms it; discarding only clears this browser request. Reload plans to see the current state.</p><button disabled={busy} onClick={() => void mutate(pending.method)} className="ml-3 underline">Retry same change</button>
      <button disabled={busy} onClick={() => { clearPending(); setError(""); }} className="ml-3 underline">Discard pending request</button></>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
function PlanningInner({ user }: { user: User }) {
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true; let epoch = 0;
    async function load() {
      const requestEpoch = ++epoch;
      setPlans([]); setLoading(true); setError("");
      try { const data = await planningRequest(user, "/api/plans"); if (live && requestEpoch === epoch) setPlans(data.plans); }
      catch (cause) { if (live && requestEpoch === epoch) setError(planningMessage(cause)); }
      finally { if (live && requestEpoch === epoch) setLoading(false); }
    }
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    void load(); window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { live = false; window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [user, version]);
  return <main className="mx-auto max-w-3xl space-y-4 p-6 text-slate-900">
    <h1 className="text-3xl font-bold">Planned outfits</h1>
    <p>Outfits you set aside for a day. Plans stay separate from likes and reported wears; passing the date does not mark an outfit worn.</p>
    <a href="/memory" className="text-blue-700 underline">Find a suggestion in wear memory</a>
    {notice && <p role="status">{notice}</p>}
    {loading && <p>Loading planned outfits…</p>}
    {error && <p role="alert">{error} <button className="underline" onClick={() => setVersion(v => v + 1)}>Reload plans</button></p>}
    {!loading && !error && !plans.length && <p>No planned outfits yet. Open a shown proposal and choose Plan this outfit.</p>}
    {plans.map(plan => <PlanCard key={`${plan.planId}:${plan.revision}`} user={user} plan={plan} onChanged={() => { setNotice("Plan updated. This did not create or change a wear report."); setVersion(v => v + 1); }} />)}
  </main>;
}
export default function PlanningPage() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user ? <PlanningInner key={user.uid} user={user} /> : <p>Loading planned outfits…</p>;
}
