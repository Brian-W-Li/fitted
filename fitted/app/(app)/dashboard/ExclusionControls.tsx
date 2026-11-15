"use client";

import { useEffect, useRef, useState } from "react";
import type { ExclusionInput } from "@/lib/explicitExclusions";
import { resolveImageSrc } from "@/lib/imageUrl";
import { findExclusionSet, type StyleContextSelection, type StyleMemoryCommand, type StyleMemoryState } from "@/lib/styleMemory/contract";
import type { StyleMemoryUser } from "@/lib/styleMemory/client";

type SaveInput = Omit<Extract<StyleMemoryCommand, { kind: "set_exclusions" }>, "operationId" | "expectedRevision">;
interface Props {
  user: StyleMemoryUser;
  memory: StyleMemoryState;
  context: StyleContextSelection | null;
  disabled: boolean;
  oneRequest: ExclusionInput;
  onOneRequestChange(input: ExclusionInput): void;
  onSave(input: SaveInput): void;
}
type Piece = { id: string; name: string; isAvailable?: boolean; imagePath?: string; imageUrl?: string };
type Rule = { kind: "item" | "combination"; itemIds: string[] };
type Scope = "request" | "saved";
type Undo = { scope: Scope; contextKey: string; rule: Rule };
const field = "block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const button = "rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40";
const members = (rule: Rule) => [...rule.itemIds].sort();
const key = (rule: Rule) => `${rule.kind}:${members(rule).join("|")}`;
const rules = (input: ExclusionInput): Rule[] => [...input.itemIds.map(id => ({ kind: "item" as const, itemIds: [id] })), ...input.outfitItemIds.map(ids => ({ kind: "combination" as const, itemIds: ids }))];
const inputFor = (entries: Rule[]): ExclusionInput => ({ itemIds: entries.filter(entry => entry.kind === "item").map(entry => entry.itemIds[0]).sort(),
  outfitItemIds: entries.filter(entry => entry.kind === "combination").map(members).sort((a, b) => a.join("|").localeCompare(b.join("|"))) });
const scopeKey = (context: StyleContextSelection | null) => context ? JSON.stringify([context.boardId, context.profileId, context.profileVersion, context.routineId, context.routineVersion]) : "none";

/** Owner-keyed local state and aborted reads keep the previous closet out of a new session. */
export default function ExclusionControls(props: Props) { return <OwnerControls key={props.user.uid} {...props} />; }

function OwnerControls(props: Props) {
  const { user, memory, context, disabled, oneRequest, onOneRequestChange, onSave } = props;
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  const [pieces, setPieces] = useState<Piece[] | null>(null), [loadError, setLoadError] = useState("");
  const [undo, setUndo] = useState<Undo | null>(null), [actionError, setActionError] = useState("");
  const userRef = useRef(user); userRef.current = user;
  useEffect(() => {
    if (!open || pieces) return;
    const controller = new AbortController(); let current = true;
    setLoadError("");
    void (async () => {
      try {
        const token = await userRef.current.getIdToken();
        if (!current || controller.signal.aborted) return;
        const response = await fetch("/api/wardrobe", { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("wardrobe unavailable");
        const body = await response.json();
        if (!Array.isArray(body?.items) || body.items.length > 2000 || body.items.some((item: Piece) => !item || typeof item.id !== "string" || !/^[a-f0-9]{24}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim())) throw new Error("incomplete wardrobe");
        if (current && !controller.signal.aborted) setPieces(body.items.map((item: Piece) => ({ id: item.id, name: item.name, isAvailable: item.isAvailable,
          imagePath: typeof item.imagePath === "string" ? item.imagePath : undefined, imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined })));
      } catch { if (current && !controller.signal.aborted) setLoadError("Couldn't load your wardrobe. Existing exclusions can still be removed."); }
    })();
    return () => { current = false; controller.abort(); };
  }, [open, retry, pieces]);
  const board = context ? memory.boards.find(board => board.id === context.boardId && board.profileId === context.profileId && board.status === "active" && board.versions.some(version => version.version === context.profileVersion)) : undefined;
  const routine = context?.routineId ? memory.routines.find(routine => routine.id === context.routineId && routine.status === "active" && routine.versions.some(version => version.version === context.routineVersion)) : undefined;
  const routineLabel = routine && context ? routine.currentVersion === context.routineVersion ? routine.label : routine.versions.find(version => version.version === context.routineVersion)?.label : null;
  const canSave = !!board && (!context?.routineId || !!routine);
  const saved = canSave && context ? findExclusionSet(memory, context) : null;
  const savedRules: Rule[] = saved?.entries ?? [];
  const requestRules = rules(oneRequest), currentKey = scopeKey(context);
  const name = (id: string) => {
    const item = pieces?.find(piece => piece.id === id);
    return item ? `${item.name}${item.isAvailable === false ? " (currently unavailable)" : ""}` : pieces ? "Unavailable piece" : "Piece (load names)";
  };
  const describe = (rule: Rule) => rule.itemIds.map(name).join(" + ");
  const applicable = (scope: Scope) => scope === "request" ? requestRules : savedRules;
  function apply(scope: Scope, entries: Rule[]) {
    const input = inputFor(entries);
    if (input.itemIds.length > 20 || input.outfitItemIds.length > 20) { setActionError("Keep up to 20 piece exclusions and 20 exact outfit exclusions in each scope. Remove one first."); return false; }
    setActionError("");
    if (scope === "request") onOneRequestChange(input);
    else {
      if (!canSave || !context) { setActionError("Choose an available saved direction and situation before saving exclusions."); return false; }
      onSave({ kind: "set_exclusions", boardId: context.boardId, profileVersion: context.profileVersion, routineId: context.routineId,
        routineVersion: context.routineVersion, expectedSetRevision: saved?.revision ?? 0, ...input });
    }
    return true;
  }
  function remove(scope: Scope, rule: Rule) {
    if (disabled) return;
    if (apply(scope, applicable(scope).filter(entry => key(entry) !== key(rule)))) setUndo({ scope, contextKey: currentKey, rule });
  }
  const undoApplicable = undo && (undo.scope === "request" || undo.contextKey === currentKey);
  const undoReady = undoApplicable && !applicable(undo.scope).some(entry => key(entry) === key(undo.rule));
  return <div className="mt-3 min-w-0">
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">Leave pieces or an exact outfit out</summary>
      <div className="mt-3 space-y-4 text-sm">
        <p>These are explicit instructions, separate from likes and notes. An exact outfit excludes only that complete set; its pieces can still appear in other outfits.</p>
        {!pieces && !loadError && open && <p role="status">Loading your wardrobe…</p>}
        {loadError && <div role="alert"><p>{loadError}</p><button type="button" className={button} disabled={disabled} onClick={() => setRetry(value => value + 1)}>Retry wardrobe</button></div>}
        <Editor key={currentKey} pieces={pieces} disabled={disabled} canSave={canSave} entriesFor={applicable} onApply={apply} name={name} />
        <div><h4 className="font-medium">Next request only</h4><p className="text-xs text-slate-600">Used for the next request you send. Saved directions are not changed.</p>
          <RuleList label="Next-request exclusions" entries={requestRules} describe={describe} disabled={disabled} onRemove={rule => remove("request", rule)} />
        </div>
        {canSave && <div><h4 className="font-medium">This saved direction and situation</h4><p className="text-xs text-slate-600 break-words">{board?.label} · {routineLabel ?? "No saved situation"}. Direction version {context?.profileVersion}{context?.routineVersion ? ` / situation version ${context.routineVersion}` : ""}. Applies to this saved meaning only.</p>
          <RuleList label="Saved exclusions" entries={savedRules} describe={describe} disabled={disabled} onRemove={rule => remove("saved", rule)} />
        </div>}
        {undoApplicable && <button type="button" className={button} disabled={disabled || !undoReady} onClick={() => {
          if (undo && !disabled && undoReady && apply(undo.scope, [...applicable(undo.scope), undo.rule])) setUndo(null);
        }}>Undo last removal</button>}
        {actionError && <p role="alert">{actionError}</p>}
      </div>
    </details>
    {(requestRules.length > 0 || savedRules.length > 0) && <p className="mt-1 text-xs text-slate-600">{requestRules.length} exclusions for the next request · {savedRules.length} saved for this direction and situation</p>}
  </div>;
}

function RuleList({ label, entries, describe, disabled, onRemove }: { label: string; entries: Rule[]; describe(rule: Rule): string; disabled: boolean; onRemove(rule: Rule): void }) {
  return entries.length ? <ul aria-label={label} className="mt-2 space-y-2">{entries.map(rule => <li key={key(rule)} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2">
    <span className="min-w-0 break-words">{rule.kind === "item" ? "One piece" : "Exact outfit"}: {describe(rule)}</span>
    <button type="button" className={button} disabled={disabled} aria-label={`Remove ${rule.kind === "item" ? "piece" : "exact outfit"}: ${describe(rule)}`} onClick={() => onRemove(rule)}>Remove</button>
  </li>)}</ul> : <p className="mt-1 text-xs text-slate-500">None.</p>;
}

function Editor({ pieces, disabled, canSave, entriesFor, onApply, name }: { pieces: Piece[] | null; disabled: boolean; canSave: boolean;
  entriesFor(scope: Scope): Rule[]; onApply(scope: Scope, entries: Rule[]): boolean; name(id: string): string }) {
  const [scope, setScope] = useState<Scope>("request"), [kind, setKind] = useState<Rule["kind"]>("item");
  const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState("");
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (disabled || !pieces) return;
    if (!selected.length || (kind === "item" && selected.length !== 1) || selected.length > 5) { setError(kind === "item" ? "Choose one owned piece." : "Choose the complete outfit, from one to five unique pieces."); return; }
    if (selected.some(id => !pieces.some(piece => piece.id === id))) { setError("Choose pieces from your current wardrobe."); return; }
    const entry: Rule = { kind, itemIds: [...selected].sort() }, current = entriesFor(scope);
    if (current.some(rule => key(rule) === key(entry))) { setError("That exclusion is already listed in this scope."); return; }
    if (onApply(scope, [...current, entry])) setError("");
  }}>
    <label className="block">Scope<select className={field} aria-label="Exclusion scope" value={scope} disabled={disabled} onChange={event => { setScope(event.target.value as Scope); setError(""); }}>
      <option value="request">Next request only</option><option value="saved" disabled={!canSave}>This saved direction and situation</option>
    </select></label>
    <label className="block">Type<select className={field} aria-label="Exclusion type" value={kind} disabled={disabled} onChange={event => { setKind(event.target.value as Rule["kind"]); setSelected([]); setError(""); }}>
      <option value="item">One piece</option><option value="combination">Exact outfit</option>
    </select></label>
    <fieldset disabled={disabled || !pieces} className="max-h-72 space-y-2 overflow-y-auto rounded border border-slate-200 p-2"><legend>Owned pieces{kind === "combination" ? " (choose 1–5)" : " (choose one)"}</legend>
      {pieces?.map(piece => { const src = resolveImageSrc(piece.imageUrl || piece.imagePath); return <label key={piece.id} className="flex min-w-0 items-center gap-2 rounded p-1">
        <input type={kind === "item" ? "radio" : "checkbox"} name="exclusion-piece" checked={selected.includes(piece.id)} onChange={event => {
          if (kind === "item") setSelected([piece.id]);
          else if (!event.target.checked) setSelected(selected.filter(id => id !== piece.id));
          else if (selected.length < 5) setSelected([...selected, piece.id]);
          else setError("Choose up to five pieces for an exact outfit.");
        }} />
        {src && <img src={src} alt="" className="h-12 w-12 shrink-0 rounded object-contain" />}<span className="break-words">{name(piece.id)}</span>
      </label>; })}
      {pieces?.length === 0 && <p>No owned pieces to choose from yet.</p>}
    </fieldset>
    {kind === "combination" && <p className="text-xs text-slate-600">Only this exact full membership is left out. A dress can be an outfit on its own.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className={button} disabled={disabled || !pieces || pieces.length === 0}>{scope === "request" ? "Leave out on next request" : "Save exclusion for this direction and situation"}</button>
  </form>;
}
