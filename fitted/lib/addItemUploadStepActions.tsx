import React from "react";

export type AddItemUploadStepActionsProps = {
  imageFile: File | null;
  isAnalyzing?: boolean;
  cvError?: string | null;
  /** True when the CV service is not configured. The "Analyze photo" CTA cannot work, so it is
   *  dropped entirely and "Continue" (proceed to the details form) becomes the primary action —
   *  no dead button dressed up as the obvious choice. */
  cvUnavailable?: boolean;
  onClose: () => void;
  onAnalyze?: (file: File) => Promise<void> | void;
  onSkipToForm?: (file: File | null) => void;
};

export function AddItemUploadStepActions({
  imageFile,
  isAnalyzing,
  cvError,
  cvUnavailable,
  onClose,
  onAnalyze,
  onSkipToForm,
}: AddItemUploadStepActionsProps) {
  return (
    <>
      {cvError && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">{cvError}</p>
          {/* When CV is unavailable the footer "Continue" is the primary path, so this inline
              button would be a redundant second one — hide it. */}
          {!cvUnavailable && (
            <button
              type="button"
              onClick={() => onSkipToForm?.(imageFile)}
              className="mt-2 text-sm font-medium text-amber-900 underline hover:no-underline"
            >
              Continue manually →
            </button>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Cancel
        </button>
        {cvUnavailable ? (
          <button
            type="button"
            onClick={() => onSkipToForm?.(imageFile)}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            disabled={!imageFile || isAnalyzing}
            onClick={() => imageFile && onAnalyze?.(imageFile)}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Analyzing…
              </>
            ) : (
              "Analyze photo"
            )}
          </button>
        )}
      </div>
      {/* The tiny "skip" link is only meaningful when Analyze is the primary action; with CV off
          "Continue" already IS that action. */}
      {!cvUnavailable && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => onSkipToForm?.(imageFile)}
            className="text-xs text-slate-400 hover:text-slate-600 underline transition-colors"
          >
            Skip photo · Enter manually
          </button>
        </div>
      )}
    </>
  );
}

