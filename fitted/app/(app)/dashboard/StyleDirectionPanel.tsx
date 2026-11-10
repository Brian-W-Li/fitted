"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { selectedStyleContext, type Board, type CompiledStyleProfile, type Routine, type StyleContextSelection, type StyleMemoryCommand, type StyleMemoryState } from "@/lib/styleMemory/contract";
import { styleMemoryRequest, StyleMemoryRequestError, type StyleMemoryUser } from "@/lib/styleMemory/client";

interface Props {
  user: StyleMemoryUser | null;
  disabled?: boolean;
  refreshGeneration?: number;
  onChange(context: StyleContextSelection | null): void;
  onPendingChange?(pending: boolean): void;
  onStateChange?(state: StyleMemoryState): void;
}
type CommandInput<T> = T extends unknown ? Omit<T, "operationId" | "expectedRevision"> : never;
type EditForm = { kind: "board" | "routine"; action: "create" | "edit" | "rename"; id?: string };
const fieldClass = "mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
const buttonClass = "max-w-full break-words rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40";
const list = (text: string) => [...new Set(text.split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];
const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/** A user-keyed subtree never displays or accepts responses from a previous owner. */
export default function StyleDirectionPanel(props: Props) {
  const { user, onChange, onPendingChange } = props;
  useEffect(() => {
    if (!user) { onChange(null); onPendingChange?.(false); }
  }, [user, onChange, onPendingChange]);
  return props.user ? <OwnerPanel key={props.user.uid} {...props} user={props.user} /> : null;
}

function OwnerPanel({ user, disabled = false, refreshGeneration = 0, onChange, onPendingChange, onStateChange }: Omit<Props, "user"> & { user: StyleMemoryUser }) {
  const [memory, setMemory] = useState<StyleMemoryState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<StyleMemoryCommand | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [settledRead, setSettledRead] = useState(0);
  const consumedRefresh = useRef(refreshGeneration);
  const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState<EditForm | null>(null);
  const [erase, setErase] = useState<{ kind: "board" | "routine"; id: string; label: string } | null>(null);
  const [label, setLabel] = useState("");
  const [phrases, setPhrases] = useState<string[]>([]);
  const [phrase, setPhrase] = useState("");
  const [palette, setPalette] = useState("");
  const [patterns, setPatterns] = useState("");
  const [fits, setFits] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [formError, setFormError] = useState("");
  const lifecycle = useRef({ active: true, generation: 0, controllers: new Set<AbortController>() });
  const userRef = useRef(user);
  const onChangeRef = useRef(onChange);
  const onPendingRef = useRef(onPendingChange);
  const onStateRef = useRef(onStateChange);
  useEffect(() => { userRef.current = user; onChangeRef.current = onChange; onPendingRef.current = onPendingChange; onStateRef.current = onStateChange; }, [user, onChange, onPendingChange, onStateChange]);

  const refresh = useCallback(async (retainAcknowledgedState = false) => {
    const life = lifecycle.current;
    const requestGeneration = ++life.generation;
    const controller = new AbortController(); life.controllers.add(controller);
    if (retainAcknowledgedState) setRefreshRequired(true);
    setBusy(true); setError("");
    try {
      const state = await styleMemoryRequest(userRef.current, undefined, controller.signal);
      if (life.active && life.generation === requestGeneration) { setMemory(state); setRefreshRequired(false); }
    } catch (failure) {
      if (life.active && life.generation === requestGeneration) {
        if (!retainAcknowledgedState) setMemory(null);
        setError(failure instanceof Error ? failure.message : "Couldn't load saved directions.");
      }
    } finally {
      life.controllers.delete(controller);
      if (life.active && life.generation === requestGeneration) { setBusy(false); setSettledRead(requestGeneration); }
    }
  }, []);

  useEffect(() => {
    const life = lifecycle.current;
    life.active = true;
    const reportPending = onPendingRef.current;
    void refresh();
    return () => {
      life.active = false; life.generation++;
      for (const controller of life.controllers) controller.abort();
      life.controllers.clear(); reportPending?.(false);
    };
  }, [refresh]);
  useEffect(() => {
    // Consume an explicit refresh once, after any uncertain command is resolved.
    // Remounting here would lose its stable operation ID and retry state.
    if (refreshGeneration === consumedRefresh.current || busy || pending) return;
    consumedRefresh.current = refreshGeneration;
    void refresh(true);
  }, [refreshGeneration, busy, pending, refresh]);
  useEffect(() => {
    onChangeRef.current(memory ? selectedStyleContext(memory) : null);
    if (memory) onStateRef.current?.(memory);
  }, [memory]);
  // A fast refresh can batch busy=true/false together; its acknowledgement must
  // still release the parent's explicit refresh barrier after selection updates.
  useEffect(() => { onPendingRef.current?.(busy || !!pending || refreshRequired); }, [busy, pending, refreshRequired, settledRead]);

  const board = memory?.boards.find(row => row.id === memory.selectedBoardId && row.status === "active");
  const routine = memory?.routines.find(row => row.id === memory.selectedRoutineId && row.status === "active");
  const context = memory ? selectedStyleContext(memory) : null;
  const locked = disabled || busy || !!pending || refreshRequired;
  const otherLocked = locked || !!editor || !!erase;
  const compiled: CompiledStyleProfile = { aestheticKeywords: phrases, palette: list(palette), patterns: list(patterns), fits: list(fits) };

  async function send(command: StyleMemoryCommand) {
    if (disabled || busy) return;
    const life = lifecycle.current;
    const controller = new AbortController(); life.controllers.add(controller);
    const requestGeneration = ++life.generation;
    setBusy(true); setPending(command); setError(""); setNotice("");
    try {
      const state = await styleMemoryRequest(userRef.current, command, controller.signal);
      if (!life.active || life.generation !== requestGeneration) return;
      setMemory(state); setPending(null); setEditor(null); setErase(null);
      setNotice(command.kind === "create_board" || command.kind === "create_routine" ? "Saved. Choose it above when you're ready." : "Saved changes.");
    } catch (failure) {
      if (!life.active || life.generation !== requestGeneration) return;
      const requestError = failure instanceof StyleMemoryRequestError ? failure : new StyleMemoryRequestError("Couldn't confirm that change. Retry the same change.", null, true);
      if (requestError.status === 409) {
        setPending(null);
        await refresh();
        if (life.active) setError("Saved directions changed elsewhere. Review the refreshed choices before saving again.");
      } else {
        if (!requestError.uncertain) setPending(null);
        setError(requestError.message);
      }
    } finally {
      life.controllers.delete(controller);
      if (life.active && life.generation === requestGeneration) setBusy(false);
    }
  }
  function mutate(input: CommandInput<StyleMemoryCommand>) {
    if (!memory || locked) return;
    void send({ ...input, operationId: crypto.randomUUID(), expectedRevision: memory.revision } as StyleMemoryCommand);
  }
  function openEditor(kind: "board" | "routine", action: EditForm["action"], target?: Board | Routine) {
    const values = target && "profileId" in target ? target.versions.find(version => version.version === target.currentVersion)?.compiled : undefined;
    setEditor({ kind, action, ...(target ? { id: target.id } : {}) }); setErase(null);
    setLabel(target?.label ?? ""); setPhrases(values?.aestheticKeywords ?? []); setPhrase("");
    setPalette(values?.palette.join(", ") ?? ""); setPatterns(values?.patterns.join(", ") ?? ""); setFits(values?.fits.join(", ") ?? "");
    setReviewed(false); setFormError(""); setError(""); setNotice("");
  }
  function addPhrase() {
    const value = phrase.trim();
    if (!value) return;
    if (phrases.length >= 12) { setFormError("Use up to 12 style phrases."); return; }
    if (!phrases.some(entry => entry.toLowerCase() === value.toLowerCase())) setPhrases([...phrases, value]);
    setPhrase(""); setFormError("");
  }
  function reviewDirection() {
    if (!label.trim()) { setFormError("Give this direction a name."); return; }
    if (phrase.trim()) { setFormError("Add the phrase or clear its field before reviewing."); return; }
    if (!phrases.length) { setFormError("Add at least one style word or phrase."); return; }
    if (phrases.join(", ").length > 500) { setFormError("Shorten the style phrases to 500 characters in total."); return; }
    if ([compiled.palette, compiled.patterns, compiled.fits].some(values => values.length > 12 || values.some(value => value.length > 60))) {
      setFormError("Use up to 12 terms of 60 characters in each optional field."); return;
    }
    setReviewed(true); setFormError("");
  }
  function saveForm() {
    if (!editor || !label.trim()) return;
    if (editor.kind === "board") {
      if (editor.action === "rename") mutate({ kind: "rename_board", boardId: editor.id!, label: label.trim() });
      else if (editor.action === "edit") mutate({ kind: "edit_board", boardId: editor.id!, rawSource: phrases.join(", "), compiled });
      else mutate({ kind: "create_board", id: newId(), profileId: newId(), label: label.trim(), rawSource: phrases.join(", "), compiled });
    } else if (editor.action === "create") mutate({ kind: "create_routine", id: newId(), label: label.trim() });
    else mutate({ kind: editor.action === "edit" ? "edit_routine" : "rename_routine", routineId: editor.id!, label: label.trim() });
  }

  return <section aria-label="Saved style direction" className="mt-4 min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
    <div><h3 className="font-semibold">Your direction today <span className="text-sm font-normal text-slate-500">(optional)</span></h3>
      <p className="mt-1 text-sm text-slate-600">Reuse a style direction and situation, or keep today&apos;s request open.</p></div>
    {busy && !memory && <p role="status" className="text-sm">Loading saved directions…</p>}
    {memory && <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Style direction
          <select aria-label="Style direction" className={fieldClass} value={board?.id ?? ""} disabled={otherLocked} onChange={event => {
            const next = memory.boards.find(row => row.id === event.target.value);
            const defaultRoutine = memory.routines.find(row => row.id === next?.defaultRoutineId && row.status === "active");
            mutate({ kind: "select_context", boardId: next?.id ?? null, routineId: defaultRoutine?.id ?? null });
          }}><option value="">No saved direction</option>{memory.boards.filter(row => row.status === "active").map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select>
        </label>
        <label className="min-w-0 text-sm font-medium">Saved situation
          <select aria-label="Saved situation" className={fieldClass} value={routine?.id ?? ""} disabled={otherLocked || !board} onChange={event => mutate({ kind: "select_context", boardId: board!.id, routineId: event.target.value || null })}>
            <option value="">No saved situation</option>{memory.routines.filter(row => row.status === "active").map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select>
        </label>
      </div>
      {board && <p className="text-sm text-slate-600 break-words">{board.versions.find(version => version.version === board.currentVersion)?.compiled.aestheticKeywords.join(" · ")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("board", "create")}>New direction</button>
        <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("routine", "create")}>New situation</button>
        <button type="button" className={buttonClass} disabled={otherLocked} aria-expanded={manage} onClick={() => setManage(!manage)}>{manage ? "Close management" : "Manage saved choices"}</button>
      </div>
      {board && routine ? <div className="text-sm space-y-1">
        <label className="flex items-start gap-2"><input type="checkbox" checked={context?.learningEnabled ?? false} disabled={otherLocked} onChange={event => mutate({ kind: "set_learning", boardId: board.id, profileVersion: board.currentVersion, routineId: routine.id, routineVersion: routine.currentVersion, enabled: event.target.checked })} className="mt-1" />
          <span>Use experimental taste learning for {board.label} / {routine.label}</span></label>
        <p className="text-xs text-slate-600">{context?.learningEnabled ? "Learning is enabled for future feedback here. Supported traits and evidence are checked when outfits are generated; this does not mean a learned model is active yet." : "Learning is off. Your direction can still guide the stylist."}</p>
      </div> : <p className="text-xs text-slate-600">Learning is off. Choose a saved direction and situation to enable it; neither is required for outfit suggestions.</p>}
      {manage && <div className="space-y-3 border-t border-slate-200 pt-3">
        {board && <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => mutate({ kind: "set_default_routine", boardId: board.id, routineId: routine?.id ?? null })}>Remember this situation for {board.label}</button>}
        <h4 className="text-sm font-semibold">Directions</h4>
        {!memory.boards.length && <p className="text-sm text-slate-600">No saved directions yet.</p>}
        {memory.boards.map(row => <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium break-words">{row.label}{row.status === "archived" ? " · Archived" : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.status === "active" && <><button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("board", "edit", row)}>Edit meaning: {row.label}</button>
              <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("board", "rename", row)}>Rename: {row.label}</button></>}
            <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => mutate({ kind: row.status === "active" ? "archive_board" : "restore_board", boardId: row.id })}>{row.status === "active" ? "Archive" : "Restore"}: {row.label}</button>
            <button type="button" className={`${buttonClass} text-red-700`} disabled={otherLocked} onClick={() => setErase({ kind: "board", id: row.id, label: row.label })}>Erase: {row.label}</button>
          </div>
        </div>)}
        <h4 className="text-sm font-semibold">Situations</h4>
        {!memory.routines.length && <p className="text-sm text-slate-600">No saved situations yet.</p>}
        {memory.routines.map(row => <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium break-words">{row.label}{row.status === "archived" ? " · Archived" : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.status === "active" && <><button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("routine", "edit", row)}>Change situation: {row.label}</button>
              <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => openEditor("routine", "rename", row)}>Rename: {row.label}</button></>}
            <button type="button" className={buttonClass} disabled={otherLocked} onClick={() => mutate({ kind: row.status === "active" ? "archive_routine" : "restore_routine", routineId: row.id })}>{row.status === "active" ? "Archive" : "Restore"}: {row.label}</button>
            <button type="button" className={`${buttonClass} text-red-700`} disabled={otherLocked} onClick={() => setErase({ kind: "routine", id: row.id, label: row.label })}>Erase: {row.label}</button>
          </div>
        </div>)}
      </div>}
    </>}
    {editor && <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-3" role="group" aria-label={`${editor.action === "create" ? "New" : "Edit"} ${editor.kind === "board" ? "direction" : "situation"}`}>
      <h4 className="font-medium">{editor.action === "create" ? "New" : editor.action === "rename" ? "Rename" : "Edit"} {editor.kind === "board" ? "direction" : "situation"}</h4>
      {editor.action === "edit" && <p className="text-sm text-amber-900">This changes its meaning. Learning stays with the old version; this version starts with learning off.</p>}
      {!reviewed && <>
        <label className="block text-sm">Name<input aria-label="Saved choice name" className={fieldClass} value={label} onChange={event => setLabel(event.target.value)} maxLength={60} disabled={locked || (editor.kind === "board" && editor.action === "edit")} /></label>
        {editor.kind === "board" && editor.action !== "rename" && <>
          <div className="flex flex-wrap gap-2">{phrases.map((entry, index) => <span key={entry} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm"><span className="min-w-0 break-words">{entry}</span><button type="button" className="shrink-0" aria-label={`Remove style phrase ${entry}`} disabled={locked} onClick={() => setPhrases(phrases.filter((_, item) => item !== index))}>×</button></span>)}</div>
          <label className="block text-sm">Style word or phrase<input aria-label="Style word or phrase" className={fieldClass} value={phrase} disabled={locked} maxLength={60} placeholder="e.g. relaxed, clean lines" onChange={event => setPhrase(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addPhrase(); } }} /></label>
          <button type="button" className={buttonClass} disabled={locked || !phrase.trim()} onClick={addPhrase}>Add style phrase</button>
          <details><summary className="cursor-pointer text-sm">Optional palette, pattern and cut</summary><div className="mt-2 space-y-2">
            <label className="block text-sm">Palette (comma separated)<input aria-label="Palette (comma separated)" className={fieldClass} value={palette} disabled={locked} maxLength={500} onChange={event => setPalette(event.target.value)} placeholder="olive, cream" /></label>
            <label className="block text-sm">Patterns (comma separated)<input aria-label="Patterns (comma separated)" className={fieldClass} value={patterns} disabled={locked} maxLength={500} onChange={event => setPatterns(event.target.value)} placeholder="solid, striped" /></label>
            <label className="block text-sm">Cut preferences (comma separated)<input aria-label="Cut preferences (comma separated)" className={fieldClass} value={fits} disabled={locked} maxLength={500} onChange={event => setFits(event.target.value)} placeholder="relaxed, regular" /></label>
          </div></details>
          <p className="text-xs text-slate-500">These are the words you choose. We don&apos;t infer garment facts or personal fit from them.</p>
        </>}
      </>}
      {reviewed && <div className="space-y-1 text-sm break-words" aria-label="Direction review"><p className="font-medium">{label}</p><p>{phrases.join(" · ")}</p>
        {compiled.palette.length > 0 && <p>Palette: {compiled.palette.join(", ")}</p>}{compiled.patterns.length > 0 && <p>Patterns: {compiled.patterns.join(", ")}</p>}{compiled.fits.length > 0 && <p>Cut: {compiled.fits.join(", ")}</p>}
        <p className="text-xs text-slate-500">Only this reviewed summary guides the stylist.</p></div>}
      {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={locked} onClick={() => setEditor(null)}>Cancel editing</button>
        {reviewed && <button type="button" className={buttonClass} disabled={locked} onClick={() => setReviewed(false)}>Back to editing</button>}
        {editor.kind === "board" && editor.action !== "rename" && !reviewed ? <button type="button" className={buttonClass} disabled={locked} onClick={reviewDirection}>Review direction</button> :
          <button type="button" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={locked || !label.trim()} onClick={saveForm}>{editor.action === "create" ? `Save ${editor.kind === "board" ? "direction" : "situation"}` : "Save changes"}</button>}
      </div>
    </div>}
    {erase && <div role="alertdialog" aria-label={`Erase ${erase.label}`} className="rounded-lg border border-red-300 bg-white p-3 space-y-2">
      <p className="text-sm font-medium">Permanently erase {erase.label}?</p>
      <p className="text-sm">Its saved meaning and learning will be erased. Linked outfit proposals and plans become unavailable. Independently reported wears remain. Archive keeps history and can be undone.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={locked} onClick={() => setErase(null)}>Keep this saved choice</button>
        <button type="button" className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={locked} onClick={() => mutate(erase.kind === "board" ? { kind: "erase_board", boardId: erase.id } : { kind: "erase_routine", routineId: erase.id })}>Erase permanently</button></div>
    </div>}
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{error}</p>
      {pending ? <><p>The change is still unconfirmed. Outfit requests wait until it is resolved.</p><button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => void send(pending)}>Retry same change</button></> :
        (refreshRequired || !memory) && <>{refreshRequired && <p>Outfit requests wait until saved directions are refreshed.</p>}<button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => void refresh(refreshRequired)}>Retry saved directions</button></>}
    </div>}
  </section>;
}
