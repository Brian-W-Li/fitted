"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExclusionRef } from "@/lib/explicitExclusions";
import { findExclusionSet, type ExclusionScopeSelection } from "@/lib/styleMemory/contract";
import { styleMemoryRequest, type StyleMemoryUser } from "@/lib/styleMemory/client";

export interface ExclusionPreview {
  pending: boolean;
  error: string;
  ref: ExclusionRef | null;
  entries: Array<{ kind: "item" | "combination"; names: string[] }>;
  retry(): void;
}
type ReadState = Omit<ExclusionPreview, "retry"> & { key: string };
const idle = { pending: false, error: "", ref: null, entries: [] };
const unavailable = "This saved direction or situation is no longer available. Refresh its source before requesting outfits.";

/** Resolve exactly the retained source scope; no current-version/default-context substitution. */
export default function useExclusionPreview(user: StyleMemoryUser | null, context: ExclusionScopeSelection | null | undefined,
  enabled: boolean, refreshGeneration = 0): ExclusionPreview {
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => setRetryGeneration(value => value + 1), []);
  const applicable = !!user && !!context && enabled;
  const intentKey = JSON.stringify([user?.uid ?? null, enabled, context?.boardId ?? null, context?.profileId ?? null, context?.profileVersion ?? null,
    context?.routineId ?? null, context?.routineVersion ?? null, refreshGeneration, retryGeneration]);
  const lifetime = useRef({ intentKey, epoch: 0 });
  if (lifetime.current.intentKey !== intentKey) lifetime.current = { intentKey, epoch: lifetime.current.epoch + 1 };
  const key = `${lifetime.current.epoch}:${intentKey}`;
  const latest = useRef({ user, context, applicable, key }); latest.current = { user, context, applicable, key };
  const epoch = useRef(0), [read, setRead] = useState<ReadState>({ key: "", ...idle });
  useEffect(() => {
    const selected = latest.current;
    if (!selected.applicable || !selected.user || !selected.context) return;
    const owner = selected.user, scope = { ...selected.context };
    const generation = ++epoch.current, controller = new AbortController(); let active = true;
    const current = () => active && !controller.signal.aborted && epoch.current === generation && latest.current.key === key;
    setRead({ key, pending: true, error: "", ref: null, entries: [] });
    void (async () => {
      try {
        const memory = await styleMemoryRequest(owner, undefined, controller.signal);
        if (!current()) return;
        const board = memory.boards.find(board => board.id === scope.boardId && board.profileId === scope.profileId && board.status === "active" &&
          board.versions.some(version => version.version === scope.profileVersion));
        const routine = scope.routineId === null ? null : memory.routines.find(routine => routine.id === scope.routineId && routine.status === "active" &&
          routine.versions.some(version => version.version === scope.routineVersion));
        if (!board || (scope.routineId === null ? scope.routineVersion !== null : !routine)) throw new Error(unavailable);
        const saved = findExclusionSet(board, scope), ref = saved ? { id: saved.id, revision: saved.revision } : null;
        let entries: ExclusionPreview["entries"] = [];
        if (saved?.entries.length) {
          const token = await owner.getIdToken();
          if (!current()) return;
          const response = await fetch("/api/wardrobe", { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) throw new Error("Couldn't load the pieces in your saved exclusions. Retry before requesting outfits.");
          const body = await response.json();
          if (!current()) return;
          if (!Array.isArray(body?.items) || body.items.length > 2000 || body.items.some((item: { id?: unknown; name?: unknown }) => !item || typeof item.id !== "string" ||
            !/^[a-f0-9]{24}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim())) throw new Error("Saved exclusion names returned an incomplete response. Retry before requesting outfits.");
          const names = new Map<string, string>(body.items.map((item: { id: string; name: string }) => [item.id, item.name.trim()]));
          entries = saved.entries.map(entry => ({ kind: entry.kind, names: entry.itemIds.map(id => names.get(id) ?? "Unavailable piece") }));
        }
        if (current()) setRead({ key, pending: false, error: "", ref, entries });
      } catch (failure) {
        if (current()) setRead({ key, pending: false, error: failure instanceof Error ? failure.message : "Couldn't check saved exclusions. Retry before requesting outfits.", ref: null, entries: [] });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [key]);
  // Render-time fencing hides the old owner's/context's data before effect cleanup runs.
  if (!applicable) return { ...idle, retry };
  return read.key === key ? { pending: read.pending, error: read.error, ref: read.ref, entries: read.entries, retry }
    : { pending: true, error: "", ref: null, entries: [], retry };
}

export { useExclusionPreview };
