"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import SavedGarmentList from "@/app/ui/SavedGarmentList";
import VariationForm from "../VariationForm";
import PlanForm from "./PlanForm";
import { planDayHint, type PlanDay } from "@/lib/outfitPlanning/client";
import WearForm, { type ClosetChoice, type SuggestionView } from "../WearForm";

const WEATHER_SOURCE_LABELS = { manual: "Your expected conditions", current: "Fetched current conditions", forecast: "Fetched forecast", occasion: "Inferred from the event description", default: "Fallback assumption", unknown: "Source not recorded" };
type SavedSuggestionView = SuggestionView & { layerChoice?: { status: "off" | "offered" | "gap"; note: string | null }; weatherSource?: keyof typeof WEATHER_SOURCE_LABELS };

function SavedProposal({ user, snapshotId, candidateId, initialPlanDay }: { user: User; snapshotId: string; candidateId: string; initialPlanDay?: PlanDay }) {
  const [suggestion, setSuggestion] = useState<SavedSuggestionView | null>(null);
  const [closet, setCloset] = useState<ClosetChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closetError, setClosetError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    let epoch = 0;
    async function load() {
      const requestEpoch = ++epoch;
      setSuggestion(null); setLoading(true); setError(""); setSaved(false);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/experiences/suggestion?${new URLSearchParams({ snapshotId, candidateId })}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404
          ? "This saved proposal is no longer available. Its source may have changed or been removed."
          : response.status === 400 ? "This proposal link is incomplete or invalid." : "Couldn't load this saved proposal. Try again.");
        const data = await response.json();
        if (live && requestEpoch === epoch) setSuggestion(data.suggestion);
      } catch (cause) { if (live && requestEpoch === epoch) setError((cause as Error).message); }
      finally { if (live && requestEpoch === epoch) setLoading(false); }
    }
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, snapshotId, candidateId]);
  useEffect(() => {
    let live = true;
    void user.getIdToken().then(token => fetch("/api/wardrobe", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (live) setCloset(data.items ?? []); })
      .catch(() => { if (live) setClosetError("Couldn't load your closet for changed pieces. Reload to retry."); });
    return () => { live = false; };
  }, [user]);
  return <main className="mx-auto max-w-3xl space-y-4 p-6 text-slate-900">
    <h1 className="text-3xl font-bold">Saved proposal</h1>
    <p>This is a suggestion you were shown, separate from what you actually wore. You can return to this link later.</p>
    {loading && <p>Loading saved proposal…</p>}
    {error && <p role="alert">{error}</p>}
    {closetError && <p role="alert">{closetError}</p>}
    {suggestion && <article className="space-y-3 rounded-xl border bg-white p-4">
      <p>Suggested situation: {suggestion.suggestionContext || "Unknown"}</p>
      <p>Saved weather context: {suggestion.weatherContext || "Not recorded"}.</p>
      <p>Weather source: {WEATHER_SOURCE_LABELS[suggestion.weatherSource ?? "unknown"] ?? WEATHER_SOURCE_LABELS.unknown}. This is historical context saved with the suggestion, not a current forecast or a guarantee of suitability.</p>
      {suggestion.layerChoice?.note && <p>{suggestion.layerChoice.note}</p>}
      <SavedGarmentList items={suggestion.items} />
      {suggestion.styleMove?.oneSentence && <p>{suggestion.styleMove.oneSentence}</p>}
      <PlanForm key={`${suggestion.snapshotId}:${suggestion.candidateId}`} user={user} suggestion={suggestion} initialDay={initialPlanDay} />
      <VariationForm key={`variation:${suggestion.snapshotId}:${suggestion.candidateId}`} user={user} suggestion={suggestion} initialPlanDay={initialPlanDay} />
      <WearForm user={user} suggestion={suggestion} closet={closet} onSaved={() => setSaved(true)} />
      {saved && <p>Wear report saved. Find it in wear memory by the actual pieces and situation.</p>}
    </article>}
    <a href="/memory" className="text-blue-700 underline">Back to wear memory</a>
  </main>;
}

export default function ProposalPage() {
  const [user, setUser] = useState<User | null>(null);
  const params = useSearchParams();
  const snapshotId = params.get("snapshotId") ?? "";
  const candidateId = params.get("candidateId") ?? "";
  const initialPlanDay = planDayHint(params.get("plannedFor"), params.get("timezone"));
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (!user) return <p>Loading saved proposal…</p>;
  return <SavedProposal key={`${user.uid}:${snapshotId}:${candidateId}:${initialPlanDay?.plannedFor}:${initialPlanDay?.timezone}`} user={user} snapshotId={snapshotId} candidateId={candidateId} initialPlanDay={initialPlanDay} />;
}
