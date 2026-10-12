"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { suggestionLink } from "@/lib/suggestionLink";
import { outfitItemOrder } from "@/lib/outfitRoles";
import { resolveImageSrc } from "@/lib/imageUrl";
import WearForm, { type ClosetChoice, type ExperienceView, type MemoryItem, type SuggestionView } from "./WearForm";
import VariationForm from "./VariationForm";

class MemoryFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function forgetRequest(key: string) {
  try { localStorage.removeItem(key); } catch { /* Optional retry storage. */ }
}
async function getJson(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new MemoryFailure(response.status, typeof data.error === "string" ? data.error : "Memory is unavailable");
  return data;
}
function ItemList({ items, onSelect }: { items: MemoryItem[]; onSelect: (id: string) => void }) {
  return <ul className="flex flex-wrap gap-2">{[...items].sort((a, b) => outfitItemOrder(a) - outfitItemOrder(b)).map(item => <li key={item.itemId} className="flex items-center gap-1">{item.imageUrl && <img src={resolveImageSrc(item.imageUrl) ?? undefined} alt={item.name} className="h-10 w-10 rounded object-contain" />}<button className="rounded border border-slate-200 bg-white px-2 py-1 text-sm text-blue-700" onClick={() => onSelect(item.itemId)}>{item.name}</button>{item.role === "mid_layer" && <span className="text-xs text-slate-500">Mid layer</span>}{item.availability !== "available" && <span className="ml-1 text-xs text-amber-700">{item.availability === "missing" ? "removed from closet" : "currently unavailable"}</span>}{item.changed && <span className="ml-1 text-xs text-slate-500">closet details changed</span>}</li>)}</ul>;
}
function MemoryInner({ user }: { user: User }) {
  const params = useSearchParams();
  const [garments, setGarments] = useState<ClosetChoice[]>([]);
  const [itemId, setItemId] = useState(params.get("itemId") ?? "");
  const [context, setContext] = useState("");
  const [activeContext, setActiveContext] = useState("");
  const [memories, setMemories] = useState<ExperienceView[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [retracted, setRetracted] = useState<ExperienceView[]>([]);
  const [memoryCursor, setMemoryCursor] = useState<string | null>(null);
  const [suggestionCursor, setSuggestionCursor] = useState<string | null>(null);
  const [retractedCursor, setRetractedCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionId, setActionId] = useState("");
  const [confirmErase, setConfirmErase] = useState("");
  const [version, setVersion] = useState(0);
  const loadEpoch = useRef(0);
  const pendingRetracts = useRef(new Map<string, { operationId: string; expectedPreviousRevision: number }>());
  const pageInFlight = useRef(new Set<string>());
  const [loadingPage, setLoadingPage] = useState("");
  useEffect(() => {
    if (!user) return;
    let live = true;
    void getJson(user, "/api/wardrobe").then(data => { if (live) setGarments((data.items ?? []) as typeof garments); }).catch(() => { if (live) setError("Couldn't load your closet. Retry by reloading."); });
    return () => { live = false; };
  }, [user]);
  const load = useCallback(async (kind: "memory" | "suggestions" | "retracted", cursor?: string) => {
    if (!user || !cursor || pageInFlight.current.size > 0) return;
    pageInFlight.current.add(kind);
    setLoadingPage(kind);
    setError("");
    const query = new URLSearchParams();
    if (itemId) query.set("itemId", itemId);
    if (kind !== "suggestions" && activeContext) query.set("context", activeContext);
    if (kind === "retracted") query.set("lifecycle", "retracted");
    if (cursor) query.set("cursor", cursor);
    const path = kind === "suggestions" ? "/api/experiences/suggestions" : "/api/experiences";
    const epoch = loadEpoch.current;
    try {
      const data = await getJson(user, `${path}?${query}`);
      if (epoch !== loadEpoch.current) return;
      if (kind === "memory") { setMemories(old => cursor ? [...old, ...(data.experiences as ExperienceView[])] : data.experiences as ExperienceView[]); setMemoryCursor(data.nextCursor as string | null); }
    else if (kind === "retracted") { setRetracted(old => cursor ? [...old, ...(data.experiences as ExperienceView[])] : data.experiences as ExperienceView[]); setRetractedCursor(data.nextCursor as string | null); }
      else { setSuggestions(old => cursor ? [...old, ...(data.suggestions as SuggestionView[])] : data.suggestions as SuggestionView[]); setSuggestionCursor(data.nextCursor as string | null); }
    } catch (cause) {
      if (epoch === loadEpoch.current) setError(`Couldn't load older results: ${(cause as Error).message}`);
    } finally {
      if (epoch === loadEpoch.current) { pageInFlight.current.delete(kind); setLoadingPage(""); }
    }
  }, [user, itemId, activeContext]);
  useEffect(() => {
    if (!user) return;
    const epochRef = loadEpoch;
    const pagesRef = pageInFlight;
    let live = true; loadEpoch.current++; pageInFlight.current.clear(); setLoadingPage(""); setLoading(true); setError(""); setMemories([]); setSuggestions([]); setRetracted([]); setMemoryCursor(null); setSuggestionCursor(null); setRetractedCursor(null);
    const query = new URLSearchParams(); if (itemId) query.set("itemId", itemId); if (activeContext) query.set("context", activeContext);
    const memory = getJson(user, `/api/experiences?${query}`);
    const retiredQuery = new URLSearchParams(query); retiredQuery.set("lifecycle", "retracted");
    const retired = getJson(user, `/api/experiences?${retiredQuery}`);
    const source = itemId ? getJson(user, `/api/experiences/suggestions?itemId=${encodeURIComponent(itemId)}`) : Promise.resolve({ suggestions: [], nextCursor: null });
    void Promise.all([memory, source, retired]).then(([a, b, c]) => { if (!live) return; setMemories(a.experiences as ExperienceView[]); setMemoryCursor(a.nextCursor as string | null); setSuggestions(b.suggestions as SuggestionView[]); setSuggestionCursor(b.nextCursor as string | null); setRetracted(c.experiences as ExperienceView[]); setRetractedCursor(c.nextCursor as string | null); }).catch(e => { if (live) setError(`Couldn't load wear memory: ${e.message}`); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; epochRef.current++; pagesRef.current.clear(); };
  }, [user, itemId, activeContext, version]);
  async function erase(record: ExperienceView) {
    if (!user || actionId) return;
    setActionId(record.experienceId); setError(""); setNotice("");
    try { await getJson(user, `/api/experiences/${record.experienceId}`, { method: "DELETE" }); setConfirmErase(""); setVersion(v => v + 1); }
    catch (e) { setError(`Couldn't erase report: ${(e as Error).message}`); }
    finally { setActionId(""); }
  }
  async function retract(record: ExperienceView) {
    if (!user || actionId) return;
    const key = `fitted:retract:${user.uid}:${record.experienceId}`;
    let command: { operationId: string; expectedPreviousRevision: number };
    try { command = pendingRetracts.current.get(key) ?? JSON.parse(localStorage.getItem(key) ?? "null") ?? { operationId: crypto.randomUUID(), expectedPreviousRevision: record.currentRevision }; localStorage.setItem(key, JSON.stringify(command)); }
    catch { command = pendingRetracts.current.get(key) ?? { operationId: crypto.randomUUID(), expectedPreviousRevision: record.currentRevision }; }
    pendingRetracts.current.set(key, command);
    setActionId(record.experienceId); setError(""); setNotice("");
    try { await getJson(user, `/api/experiences/${record.experienceId}/retract`, { method: "POST", body: JSON.stringify(command) }); pendingRetracts.current.delete(key); forgetRequest(key); setVersion(v => v + 1); }
    catch (e) {
      if (e instanceof MemoryFailure && [400, 404, 409, 410, 413, 415, 429].includes(e.status)) {
        pendingRetracts.current.delete(key); forgetRequest(key);
        setNotice("Retraction was not accepted. Reports have been refreshed; check the current report before trying again.");
        setVersion(v => v + 1);
      } else setError(`Couldn't retract report; retry uses the same operation: ${(e as Error).message}`);
    }
    finally { setActionId(""); }
  }
  function chooseItem(id: string) { setItemId(id); window.history.replaceState(null, "", `/memory?itemId=${encodeURIComponent(id)}`); }
  return <main className="mx-auto max-w-5xl space-y-7 p-6 text-slate-900">
    <header><h1 className="text-3xl font-bold">Wear memory</h1><p className="mt-2 text-slate-600">Remember outfits you actually wore. Suggestions and likes stay separate from wear reports.</p></header>
    <div className="flex flex-wrap gap-3 rounded-xl border bg-white p-4"><label>Garment <select aria-label="Garment" value={itemId} onChange={e => chooseItem(e.target.value)} className="ml-2 rounded border p-2"><option value="">All reported wears</option>{garments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{itemId && !garments.some(item => item.id === itemId) && <option value={itemId}>Removed garment</option>}</select></label><form onSubmit={e => { e.preventDefault(); setActiveContext(context.trim()); }}><label>Actual situation <input aria-label="Filter actual situation" maxLength={200} value={context} onChange={e => setContext(e.target.value)} className="ml-2 rounded border p-2" /></label><button className="ml-2 rounded bg-slate-900 p-2 text-white">Find</button></form></div>
    {notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {loading && <p>Loading…</p>}
    <section className="space-y-3"><h2 className="text-xl font-semibold">Reported wears</h2>{!loading && !memories.length && <p className="text-slate-600">{memoryCursor ? "No matches on this page. Continue to older reports." : "No reported wears for this selection yet."}</p>}{memories.map(record => <article key={record.experienceId} className="rounded-xl border bg-white p-4 space-y-2"><p className="font-medium">Actual pieces worn</p><ItemList items={record.items} onSelect={chooseItem}/>{record.state.compositionStatus === "changed" && record.sourceItems && <p className="text-sm text-slate-600">Original suggestion: {record.sourceItems.map(item => item.name).join(", ") || "unavailable"}. These were suggested, not all reported as worn.</p>}<p>Worn {record.state.occurredOn} · Actual situation: {record.state.context.confirmed || record.state.context.source === "user" ? record.state.context.rawOccasion || "Unknown" : "Unconfirmed"} · Outcome: {record.state.outcome === "worked" ? "Worked for me" : record.state.outcome === "change_next_time" ? "Change next time" : "Unknown"}</p>{!record.sourceAvailable && <p className="text-amber-700">Original suggestion is no longer available.</p>}{<WearForm key={`${record.experienceId}:${record.currentRevision}`} user={user} closet={garments} onStarted={() => setNotice("")} experience={record} onSaved={() => { setNotice("Wear report saved."); setVersion(v => v + 1); }} />}<VariationForm user={user} experience={record} /><div className="flex gap-3 text-sm"><button disabled={!!actionId} onClick={() => void retract(record)} className="text-amber-700 underline">Retract report</button>{confirmErase === record.experienceId ? <><button disabled={!!actionId} onClick={() => void erase(record)} className="text-red-700 underline">Confirm permanent erasure</button><button onClick={() => setConfirmErase("")}>Cancel</button></> : <button onClick={() => setConfirmErase(record.experienceId)} className="text-red-700 underline">Erase report</button>}</div></article>)}{!loading && memoryCursor && <button disabled={!!loadingPage} className="text-blue-700 underline disabled:opacity-50" onClick={() => void load("memory", memoryCursor)}>More reported wears</button>}</section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Retracted reports</h2><p className="text-sm text-slate-600">Retracted reports do not appear in active recall. Erase one to remove its stored details.</p>{!loading && !retracted.length && <p className="text-slate-600">{retractedCursor ? "No matches on this page. Continue to older retracted reports." : "No retracted reports for this selection."}</p>}{retracted.map(record => <article key={record.experienceId} className="rounded-xl border bg-white p-4 space-y-2"><ItemList items={record.items} onSelect={chooseItem}/><p>Worn {record.state.occurredOn} · Outcome: {record.state.outcome}</p>{confirmErase === record.experienceId ? <><button disabled={!!actionId} onClick={() => void erase(record)} className="text-red-700 underline">Confirm permanent erasure</button><button onClick={() => setConfirmErase("")} className="ml-3">Cancel</button></> : <button onClick={() => setConfirmErase(record.experienceId)} className="text-red-700 underline">Erase report</button>}</article>)}{!loading && retractedCursor && <button disabled={!!loadingPage} className="text-blue-700 underline disabled:opacity-50" onClick={() => void load("retracted", retractedCursor)}>More retracted reports</button>}</section>
    {itemId && <section className="space-y-3"><h2 className="text-xl font-semibold">Recent suggestions for this garment</h2><p className="text-sm text-slate-600">These were shown to you. They may be unliked and have not been counted as worn.</p>{!loading && !suggestions.length && <p>{suggestionCursor ? "No matches on this page. Continue to older suggestions." : "No recent suggestions for this garment."}</p>}{suggestions.map(s => <article key={`${s.snapshotId}:${s.candidateId}`} className="rounded-xl border bg-slate-50 p-4 space-y-2"><ItemList items={s.items} onSelect={chooseItem}/><p className="text-sm">Suggested situation: {s.suggestionContext || "Unknown"}</p><a href={suggestionLink(s)} className="text-sm text-blue-700 underline">Open saved proposal / report wear</a>{memories.some(m => m.source?.snapshotId === s.snapshotId && m.source?.candidateId === s.candidateId) && <p className="text-sm text-emerald-700">You reported a wear from this suggestion. Check the actual pieces in Reported wears above; you can report a different wear below.</p>}<WearForm user={user} closet={garments} suggestion={s} onStarted={() => setNotice("")} onSaved={() => { setNotice("Wear report saved."); setVersion(v => v + 1); }} /></article>)}{!loading && suggestionCursor && <button disabled={!!loadingPage} className="text-blue-700 underline disabled:opacity-50" onClick={() => void load("suggestions", suggestionCursor)}>More suggestions</button>}</section>}
  </main>;
}
export default function MemoryPage() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (!user) return <p>Loading wear memory…</p>;
  // Keying the entire view discards fetched records, pending cursors and mutation state on an auth switch.
  return <MemoryInner key={user.uid} user={user} />;
}
