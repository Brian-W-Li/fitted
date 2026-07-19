"use client";

/**
 * D-3 — durable dislike-reason enrich (in-session).
 *
 * A one-tap dislike posts a reasonless `rejected` immediately (symmetry with Like — a dislike costs
 * the same tap). The optional "tell us why?" modal then attaches the structured reasons as a SECOND
 * same-action row that per-candidate latest-state (§23-H61) collapses onto the first — never
 * double-counted. The bug this closes: the old flow discarded the composed reasons BEFORE the enrich
 * POST resolved, so a transient failure silently lost the sole trainable "why" channel (§16).
 *
 * This hook HOLDS the composed reasons so a failure surfaces a per-card RETRY instead of vanishing.
 * It is IN-SESSION ONLY (state, never persisted across loads) — deliberately. The enrich lands within
 * seconds of the dislike, so its fresh server-side `createdAt` **practically never** overtakes a later
 * flip/remove on the same candidate (the pathological case needs an abnormally slow in-flight enrich
 * AND an immediate cross-page flip of the same card — bounded by normal enrich latency, not truly
 * impossible). Persisting it across loads would WIDEN that window into a routine one (a queued enrich
 * landing after a flip on the next visit), which is why cross-load persistence is intentionally absent
 * — do NOT add it without re-solving that. The dashboard also reconciles restored feedback chips
 * against server latest-state on return (`lib/feedbackReconcile.ts`), which closes the common
 * dislike→navigate→flip→return→"tell us why" re-entry that a stale persisted mark would otherwise open.
 *
 * Injectable `postEnrich` so the state machine is unit-tested without the dashboard (firebase/network).
 */
import { useCallback, useState } from "react";

export interface EnrichBinding {
  snapshotId: string;
  candidateId: string;
}
export interface EnrichData {
  perItemFeedback: { itemId: string; disliked: boolean; notes?: string }[];
  codes: string[];
}
/** Persist the reasons (a `rejected` row carrying feedbackReason/perItemFeedback). true == persisted. */
export type PostEnrich = (binding: EnrichBinding, data: EnrichData) => Promise<boolean>;

export function enrichKey(b: EnrichBinding): string {
  return `${b.snapshotId}:${b.candidateId}`;
}

interface PendingEnrich {
  binding: EnrichBinding;
  data: EnrichData;
  status: "saving" | "failed";
}

export interface DislikeEnrich {
  /** Attempt (or re-attempt) the enrich; resolves to the persisted result. */
  saveDislikeReasons: (binding: EnrichBinding, data: EnrichData) => Promise<boolean>;
  /** Retry a failed enrich, resending the held reasons verbatim. No-op if nothing is pending. */
  retryEnrich: (binding: EnrichBinding) => void;
  /** "saving" | "failed" | undefined (settled) — drives the per-card affordance. */
  statusFor: (binding: EnrichBinding) => "saving" | "failed" | undefined;
}

export function useDislikeEnrich(postEnrich: PostEnrich): DislikeEnrich {
  const [byKey, setByKey] = useState<Record<string, PendingEnrich>>({});

  const attempt = useCallback(
    async (binding: EnrichBinding, data: EnrichData): Promise<boolean> => {
      const key = enrichKey(binding);
      setByKey((m) => ({ ...m, [key]: { binding, data, status: "saving" } }));
      const ok = await postEnrich(binding, data);
      setByKey((m) => {
        const next = { ...m };
        if (ok) {
          delete next[key];
        } else if (next[key]) {
          // Hold the reasons (binding + data) for retry — never drop them.
          next[key] = { ...next[key], status: "failed" };
        }
        return next;
      });
      return ok;
    },
    [postEnrich],
  );

  const retryEnrich = useCallback(
    (binding: EnrichBinding) => {
      const entry = byKey[enrichKey(binding)];
      if (entry) void attempt(entry.binding, entry.data);
    },
    [byKey, attempt],
  );

  const statusFor = useCallback(
    (binding: EnrichBinding) => byKey[enrichKey(binding)]?.status,
    [byKey],
  );

  return { saveDislikeReasons: attempt, retryEnrich, statusFor };
}
