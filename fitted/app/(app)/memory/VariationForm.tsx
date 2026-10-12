"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { suggestionLink } from "@/lib/suggestionLink";
import { resolveImageSrc } from "@/lib/imageUrl";
import { emptyStateMessage } from "@/lib/recommendCopy";
import PlanForm from "./proposal/PlanForm";
import type { PlanDay } from "@/lib/outfitPlanning/client";
import type { ExperienceView, SuggestionView } from "./WearForm";

interface ProposalItem { itemId: string; name?: string; imageUrl?: string }
interface Proposal {
  snapshotId: string; candidateId: string; displayItems: ProposalItem[];
  styleMove?: { moveType?: string; oneSentence?: string } | null;
}
interface VariationResult {
  shown: Proposal[];
  flags?: { notEnoughItems?: boolean; insufficientAfterGeneration?: boolean; reasonHint?: string | null };
}
interface PendingVariation {
  requestId: string;
  parentSnapshotId?: string;
  variation?: { mode?: "explore"; sourceCandidateId: string; anchorItemId: string; leaveOutItemId?: string; occasion: string };
  actualVariation?: { experienceId: string; expectedRevision: number; anchorItemId: string; leaveOutItemId?: string; occasion: string };
}

function failureMessage(code: string, status: number): string {
  if (code === "forced_item_unavailable") return "The piece you chose to keep is no longer available. Update your closet or choose another piece.";
  if (code === "control_item_unavailable") return "The piece you chose to leave out is no longer available. Choose another current piece to change.";
  if (code === "experience_revision_conflict") return "This wear report changed. Reload your memory before making another proposal.";
  if (code === "experience_source_unavailable" || code === "experience_unavailable") return "This wear report is no longer available. Reload your memory.";
  if (code === "variation_source_unavailable" || status === 404) return "The original shown outfit is no longer available. Reload your memory.";
  if (status === 429) return "The stylist is busy. Try again in a minute.";
  if (status === 400) return "Those choices could not form a valid request. Check the selected pieces and situation.";
  return "The stylist could not confirm this proposal. Retry with the same request.";
}

type Props = { user: User; initialPlanDay?: PlanDay } & ({ experience: ExperienceView; suggestion?: never } | { suggestion: SuggestionView; experience?: never });

export default function VariationForm({ user, experience, suggestion, initialPlanDay }: Props) {
  const source = suggestion ?? experience?.source;
  const changed = experience?.state.compositionStatus === "changed";
  const sourceItems = suggestion?.items ?? experience!.sourceItems ?? experience!.items;
  const available = (changed ? experience!.items : sourceItems).filter(item => item.availability === "available");
  const experienceId = experience?.experienceId;
  const currentRevision = experience?.currentRevision;
  const defaultAnchorId = available[0]?.itemId ?? "";
  const defaultLeaveOutId = "";
  const [open, setOpen] = useState(false);
  const [anchorId, setAnchorId] = useState(available[0]?.itemId ?? "");
  const [leaveOutId, setLeaveOutId] = useState("");
  const [occasion, setOccasion] = useState("");
  const [explore, setExplore] = useState(false);
  const [pending, setPending] = useState<PendingVariation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VariationResult | null>(null);
  const [submittedOccasion, setSubmittedOccasion] = useState("");
  const [submittedChoice, setSubmittedChoice] = useState("");
  const storageKey = suggestion
    ? `fitted:variation:${user.uid}:shown:${suggestion.snapshotId}:${suggestion.candidateId}`
    : `fitted:variation:${user.uid}:${experienceId!}:${currentRevision!}:${changed ? "actual" : `${source?.snapshotId}:${source?.candidateId}`}`;
  const live = useRef(false);
  const busyRef = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const currentKey = useRef(storageKey);
  const previousKey = useRef(storageKey);
  currentKey.current = storageKey;
  function clearPending() {
    setPending(null);
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
  }

  useEffect(() => {
    if (previousKey.current !== storageKey) {
      try { sessionStorage.removeItem(previousKey.current); } catch { /* Optional storage. */ }
      previousKey.current = storageKey;
    }
    setResult(null); setError(""); setPending(null); setBusy(false); busyRef.current = false;
    setAnchorId(defaultAnchorId); setLeaveOutId(defaultLeaveOutId); setOccasion(""); setExplore(false);
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const command = JSON.parse(saved) as PendingVariation;
        const choice = command.actualVariation ?? command.variation;
        if (!choice || typeof command.requestId !== "string" || !command.requestId ||
          typeof choice.anchorItemId !== "string" || !/^[a-f0-9]{24}$/i.test(choice.anchorItemId) ||
          typeof choice.occasion !== "string" || !choice.occasion.trim() || choice.occasion.length > 500 ||
          (choice.leaveOutItemId !== undefined && (typeof choice.leaveOutItemId !== "string" ||
            !/^[a-f0-9]{24}$/i.test(choice.leaveOutItemId) || choice.leaveOutItemId.toLowerCase() === choice.anchorItemId.toLowerCase()))) return;
        if (changed ? command.actualVariation?.experienceId !== experienceId! || command.actualVariation.expectedRevision !== currentRevision!
          : command.parentSnapshotId !== source?.snapshotId || command.variation?.sourceCandidateId !== source?.candidateId) return;
        setPending(command); setAnchorId(choice.anchorItemId);
        setLeaveOutId(choice.leaveOutItemId ?? ""); setOccasion(choice.occasion); setExplore(command.variation?.mode === "explore"); setOpen(true);
      }
    } catch { /* In-memory retry remains available when browser storage is disabled. */ }
  }, [storageKey, source?.snapshotId, source?.candidateId, changed, experienceId, currentRevision, defaultAnchorId, defaultLeaveOutId]);

  if (suggestion?.shownVariationAllowed === false) return <p className="border-t pt-3 text-sm text-slate-700">
    This proposal was adapted from a wear report. To make another variation, <a href="/memory" className="text-blue-700 underline">open wear memory</a> and adapt the current report.
  </p>;
  if (experience && ((!changed && (!source || !experience.sourceAvailable)) || experience.lifecycle !== "active")) return null;
  async function submit() {
    if (busyRef.current || (!changed && !source)) return;
    if (!pending && (!anchorId || !occasion.trim())) {
      setError("Choose a piece to keep and a new situation.");
      return;
    }
    const previousSituation = suggestion?.suggestionContext ?? (experience?.state.context.confirmed ? experience.state.context.rawOccasion : "");
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!pending && !explore && previousSituation && normalize(occasion) === normalize(previousSituation)) {
      setError(suggestion ? "Describe a different situation from the original proposal." : "Describe a different situation from the one you reported wearing this for.");
      return;
    }
    const command: PendingVariation = pending ?? { requestId: crypto.randomUUID(), ...(changed
      ? { actualVariation: { experienceId: experienceId!, expectedRevision: currentRevision!, anchorItemId: anchorId, ...(leaveOutId ? { leaveOutItemId: leaveOutId } : {}), occasion: occasion.trim() } }
      : { parentSnapshotId: source!.snapshotId, variation: { ...(explore ? { mode: "explore" as const } : {}), sourceCandidateId: source!.candidateId, anchorItemId: anchorId, ...(leaveOutId ? { leaveOutItemId: leaveOutId } : {}), occasion: explore ? occasion : occasion.trim() } }) };
    const submittedKey = storageKey;
    setPending(command);
    try { sessionStorage.setItem(storageKey, JSON.stringify(command)); } catch { /* Optional storage. */ }
    busyRef.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const token = await user.getIdToken();
      if (!live.current || currentKey.current !== submittedKey) return;
      const response = await fetch("/api/recommend", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await response.json().catch(() => ({})) as VariationResult & { error?: { code?: string } };
      if (!live.current || currentKey.current !== submittedKey) return;
      if (!response.ok) {
        setError(failureMessage(data.error?.code ?? "", response.status));
        if (response.status < 500 && response.status !== 429) {
          clearPending();
        }
        return;
      }
      if (!Array.isArray(data.shown)) throw new Error("Missing proposal list");
      setResult(data);
      const choice = command.actualVariation ?? command.variation!;
      setSubmittedOccasion(choice.occasion);
      const kept = available.find(item => item.itemId === choice.anchorItemId)?.name ?? "the selected piece";
      const leftOut = available.find(item => item.itemId === choice.leaveOutItemId)?.name ?? "the old piece";
      setSubmittedChoice(command.variation?.mode === "explore" ? `Kept ${kept}; each proposal uses a different combination of garments from the saved outfit.` : choice.leaveOutItemId ? `Kept ${kept}; left out ${leftOut}.` : `Kept ${kept}; no piece excluded. The same combination may still suit this situation.`);
      clearPending();
    } catch {
      if (live.current && currentKey.current === submittedKey) setError("The stylist could not confirm this proposal. Retry with the same request.");
    } finally { if (live.current && currentKey.current === submittedKey) { busyRef.current = false; setBusy(false); } }
  }

  const choices = available.filter(item => item.itemId !== anchorId);
  return <div className="border-t border-slate-200 pt-3 text-sm">
    <button type="button" className="font-medium text-blue-700 underline" onClick={() => setOpen(value => !value)}>
      {open ? "Close new-outfit form" : "Make another outfit"}
    </button>
    {open && <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-slate-700">{suggestion ? "Choose a shown piece to keep. This creates a separate suggestion; it does not change plans, likes or wear reports." : changed ? "Choose from the actual pieces you reported wearing to adapt that outfit. The original suggestion is recorded separately; this new proposal is a separate suggestion." : "Choose from the original shown suggestion for a new proposal. Your reported wear stays unchanged; the proposal is separate from what you wore."}</p>
      {suggestion && <label className="block"><input type="checkbox" aria-label="Explore the saved situation" checked={explore}
        disabled={!!pending || busy} onChange={event => { const next = event.target.checked; setExplore(next);
          setOccasion(next ? suggestion.suggestionContext ?? "" : ""); setResult(null); }} /> Show another combination for the saved situation</label>}
      {explore && <p className="text-slate-700">Uses the saved situation and weather. Keeps your chosen piece and changes at least one garment; styling words alone do not count. Other pieces stay eligible unless excluded.</p>}
      {available.length < 1 && !pending ? <p className="text-amber-800">This look needs a currently available piece to keep. {suggestion ? "The saved proposal remains available above." : "The past report remains available above."}</p> : <>
        <label className="block">Keep this piece <select aria-label="Keep this piece" value={anchorId} disabled={!!pending || busy}
          onChange={event => { const next = event.target.value; setAnchorId(next); if (leaveOutId === next) setLeaveOutId(""); setResult(null); }}
          className="mt-1 block w-full min-w-0 rounded border p-2">{pending && !available.some(item => item.itemId === anchorId) && <option value={anchorId}>Previously selected piece</option>}{available.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}</select></label>
        <label className="block">Leave out this old piece (optional) <select aria-label="Leave out this old piece" value={leaveOutId} disabled={!!pending || busy}
          onChange={event => { setLeaveOutId(event.target.value); setResult(null); }} className="mt-1 block w-full min-w-0 rounded border p-2">
          <option value="">No piece excluded</option>{pending && leaveOutId && !choices.some(item => item.itemId === leaveOutId) && <option value={leaveOutId}>Previously excluded piece</option>}{choices.map(item => <option key={item.itemId} value={item.itemId}>{item.name}</option>)}
        </select></label>
        {!explore && <p className="text-slate-700">Describe the occasion and how you want to feel or dress. These guide the stylist; only keeping a piece and an exact exclusion are guaranteed.</p>}
        <label className="block">{explore ? "Saved situation" : "New situation"} <input aria-label={explore ? "Saved situation" : "New situation"} value={occasion} maxLength={500}
          disabled={!!pending || busy || explore} onChange={event => { setOccasion(event.target.value); setResult(null); }} placeholder="e.g. Relaxed dinner with friends"
          className="mt-1 block w-full min-w-0 rounded border p-2" /></label>
        {pending && <p className="text-amber-800">A previous request may have finished. Retry keeps the same request and choices.</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex gap-3"><button type="button" disabled={busy || (!pending && !occasion.trim())} onClick={() => void submit()}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">{busy ? "Finding an option…" : pending ? "Retry same request" : explore ? "Find another combination" : "Find an outfit"}</button>
          {pending && <button type="button" disabled={busy} onClick={() => { clearPending(); setError(""); }}
            className="text-slate-700 underline">Discard pending request</button>}</div>
      </>}
      {result && <section className="space-y-3 border-t border-blue-200 pt-3" aria-label="New outfit proposals">
        <h3 className="font-semibold">New proposal for {submittedOccasion}</h3>
        <p className="text-slate-700">{submittedChoice}</p>
        <p className="text-slate-700">These are new suggestions from your current closet. If you wore one, report that separately.</p>
        {result.shown.length === 0 && <p role="status">{result.flags?.notEnoughItems || result.flags?.insufficientAfterGeneration
          ? explore ? "No different combination was found for this saved situation. Try another piece or add another option to your closet." : "No outfit met those exact choices. Try changing the optional exclusion or adding another option to your closet."
          : emptyStateMessage(result.flags)}</p>}
        {result.shown.map(proposal => <article key={`${proposal.snapshotId}:${proposal.candidateId}`} className="rounded border bg-white p-3">
          <ul className="flex flex-wrap gap-3">{proposal.displayItems.map(item => <li key={item.itemId} className="flex items-center gap-2">
            {item.imageUrl && <img src={resolveImageSrc(item.imageUrl) ?? undefined} alt={item.name ?? "Garment"} className="h-12 w-12 rounded object-contain" />}
            <span>{item.name ?? "Garment"}</span></li>)}</ul>
          {proposal.styleMove?.oneSentence && <p className="mt-2 text-slate-700">{proposal.styleMove.oneSentence}</p>}
          <a href={suggestionLink(proposal, initialPlanDay)} className="mt-2 inline-block text-blue-700 underline">Open saved proposal / report wear</a>
          <PlanForm user={user} suggestion={proposal} initialDay={initialPlanDay} />
        </article>)}
      </section>}
    </div>}
  </div>;
}
