"use client";

/** Optional reasons amend one exact reaction. Held commands remain stable through
 * uncertain acknowledgments, and cannot become a new vote after a flip/removal. */
import type { FeedbackReasonValue } from "@/lib/feedbackTypes";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface EnrichBinding { snapshotId: string; candidateId: string }
export interface EnrichTarget extends EnrichBinding { reactionId: string }
export interface EnrichData {
  perItemFeedback: { itemId: string; disliked: boolean; notes?: string }[];
  codes: string[];
  reason?: FeedbackReasonValue;
}
export interface EnrichCommand {
  kind: "reason_amendment";
  reactionId: string;
  operationId: string;
  feedbackReason: FeedbackReasonValue;
  perItemFeedback: EnrichData["perItemFeedback"];
}
export type EnrichResult = "saved" | "retry" | "stale";
export type PostEnrich = (command: EnrichCommand) => Promise<EnrichResult>;
export function enrichKey(binding: EnrichBinding): string { return `${binding.snapshotId}:${binding.candidateId}`; }
interface PendingEnrich { ownerKey: string | null; target: EnrichTarget; command: EnrichCommand; status: "saving" | "failed" }
export interface DislikeEnrich {
  saveDislikeReasons: (target: EnrichTarget, data: EnrichData) => Promise<boolean>;
  retryEnrich: (target: EnrichTarget) => void;
  statusFor: (binding: EnrichBinding & { reactionId?: string }) => "saving" | "failed" | undefined;
}
export function useDislikeEnrich(postEnrich: PostEnrich, ownerKey: string | null = null): DislikeEnrich {
  const entries = useRef<Record<string, PendingEnrich>>({});
  const generation = useRef(0);
  const mounted = useRef(true);
  const [, redraw] = useState(0);
  useLayoutEffect(() => { generation.current++; entries.current = {}; }, [ownerKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; entries.current = {}; }; }, []);
  const publish = useCallback(() => { if (mounted.current) redraw(value => value + 1); }, []);
  const attempt = useCallback(async (entry: PendingEnrich): Promise<boolean> => {
    const key = enrichKey(entry.target);
    const epoch = generation.current;
    entry.status = "saving"; entries.current[key] = entry; publish();
    let outcome: EnrichResult;
    try { outcome = await postEnrich(entry.command); } catch { outcome = "retry"; }
    if (!mounted.current || generation.current !== epoch || entries.current[key] !== entry) return false;
    if (outcome === "retry") entry.status = "failed";
    else delete entries.current[key];
    publish();
    return outcome === "saved";
  }, [postEnrich, publish]);
  const saveDislikeReasons = useCallback(async (target: EnrichTarget, data: EnrichData) => {
    const key = enrichKey(target);
    const held = entries.current[key];
    // Never replace an uncertain attempt. A new current reaction has a separate target.
    if (held?.ownerKey === ownerKey && held.target.reactionId === target.reactionId) return false;
    const entry: PendingEnrich = { ownerKey, target: { ...target }, status: "saving", command: {
      kind: "reason_amendment", reactionId: target.reactionId, operationId: crypto.randomUUID(),
      feedbackReason: { ...data.reason, codes: [...data.codes] }, perItemFeedback: data.perItemFeedback.map(item => ({ ...item })),
    } };
    return await attempt(entry);
  }, [attempt, ownerKey]);
  const retryEnrich = useCallback((target: EnrichTarget) => {
    const entry = entries.current[enrichKey(target)];
    if (entry?.ownerKey === ownerKey && entry.target.reactionId === target.reactionId && entry.status === "failed") void attempt(entry);
  }, [attempt, ownerKey]);
  const statusFor = useCallback((binding: EnrichBinding & { reactionId?: string }) => {
    const entry = entries.current[enrichKey(binding)];
    return entry?.ownerKey === ownerKey && entry.target.reactionId === binding.reactionId ? entry.status : undefined;
  }, [ownerKey]);
  return { saveDislikeReasons, retryEnrich, statusFor };
}
