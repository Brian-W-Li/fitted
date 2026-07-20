"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebaseClient";
import { cvResponseToFormValues, type CVInferResponse } from "@/lib/cvToWardrobeForm";
import { AddItemUploadStepActions } from "@/lib/addItemUploadStepActions";
import { validateWardrobeForm, normalizeColor } from "@/lib/wardrobeValidation";
import { type ClothingType } from "@/lib/clothingType";
import { applyWardrobePipeline } from "@/lib/wardrobeDisplayPipeline";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";

type WardrobeItem = {
  id: string;
  name: string;
  clothingType?: ClothingType;
  category: string;
  subCategory?: string;
  pattern?: string;
  isAvailable?: boolean;
  layerRole?: string;
  colors: string[];
  fit: string;
  size: string;
  seasons: string[];
  occasions: string[];
  notes?: string;
  imagePath?: string;
  createdAt?: string;
  updatedAt?: string;
};

// Values must match CV output (cv-service/cv.py) for pre-fill; display is Title Case in the UI.
const CATEGORY_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "one piece", label: "One piece" },
  { value: "footwear", label: "Footwear" },
] as const;
const TYPE_OPTIONS = [
  // Tops
  { value: "t-shirt", label: "T-Shirt" },
  { value: "shirt", label: "Shirt" },
  { value: "blazer", label: "Blazer" },
  { value: "sweater", label: "Sweater" },
  { value: "sweatshirt", label: "Sweatshirt" },
  { value: "hoodie", label: "Hoodie" },
  { value: "jacket", label: "Jacket" },
  { value: "cardigan", label: "Cardigan" },
  { value: "coat", label: "Coat" },
  { value: "polo", label: "Polo" },
  { value: "turtleneck", label: "Turtleneck" },
  // Bottoms
  { value: "jeans", label: "Jeans" },
  { value: "pants", label: "Pants" },
  { value: "cargos", label: "Cargos" },
  { value: "chinos", label: "Chinos" },
  { value: "shorts", label: "Shorts" },
  { value: "skirt", label: "Skirt" },
  { value: "joggers", label: "Joggers" },
  // One piece
  { value: "dress", label: "Dress" },
  { value: "jumpsuit", label: "Jumpsuit" },
  // Footwear
  { value: "sneakers", label: "Sneakers" },
  { value: "boots", label: "Boots" },
  { value: "sandals", label: "Sandals" },
  { value: "dress shoes", label: "Dress Shoes" },
  { value: "loafers", label: "Loafers" },
] as const;
const PATTERN_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "striped", label: "Striped" },
  { value: "plaid", label: "Plaid" },
  { value: "floral", label: "Floral" },
  { value: "graphic", label: "Graphic" },
] as const;
const SEASON_OPTIONS = ["Spring", "Summer", "Fall", "Winter"];
const FIT_OPTIONS = ["Slim", "Regular", "Relaxed", "Oversized"];
const CV_GUIDE_DISMISS_FOREVER_KEY = "fitted-cv-guide-dismiss-forever-v1";

// F11 — a bare "only JPEG/PNG/WEBP" silently blocks a friend on iPhone, whose photos are HEIC by
// default (→ zero corpus yield). Tell them how to get an accepted file. (Note: iOS Safari often
// auto-converts HEIC to JPEG on pick, so this fires mainly on drag-drop / non-Safari paths.)
const UNSUPPORTED_IMAGE_MSG =
  "That image type isn't supported. iPhone photos are often HEIC — take a screenshot of the photo and upload that, or set Camera → Formats to “Most Compatible”, then try again.";

/** The CSS color to paint a swatch with, or null to show the label text-only. A 6-hex always works;
 *  a name is used only if the browser resolves it as a real color (CSS.supports) — so "turquoise"/
 *  "navy" paint, and a two-word name paints via its space-collapsed CSS form ("light blue" →
 *  "lightblue", "dark red" → "darkred") while genuinely non-CSS names ("navy blue") fall back to
 *  text-only rather than an empty circle. The STORED value is unchanged (it still reads as-typed to
 *  the stylist); this only governs the display swatch. Guarded for jsdom, where CSS may be absent. */
function swatchColor(c: string): string | null {
  if (/^#[0-9A-Fa-f]{6}$/.test(c)) return c;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return null;
  if (CSS.supports("color", c)) return c;
  const compact = c.replace(/\s+/g, "");
  if (compact !== c && CSS.supports("color", compact)) return compact;
  return null;
}

function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;
  if (imagePath.startsWith("mongo:")) {
    const imageId = imagePath.slice("mongo:".length);
    return `/api/images/${imageId}`;
  }
  return null;
}


function WardrobeCard({
  item,
  onEdit,
  onDelete,
  onToggleAvailability,
}: {
  item: WardrobeItem;
  onEdit: (item: WardrobeItem) => void;
  onDelete: (item: WardrobeItem) => void;
  onToggleAvailability: (item: WardrobeItem) => void;
}) {
  const imgSrc = imageUrlFromPath(item.imagePath);
  const isAvailable = item.isAvailable ?? true;

  const categoryLabel = (item.category ?? "top").toLowerCase();
  const categoryBadgeClass =
    categoryLabel === "top"
      ? "bg-blue-100 text-blue-700"
      : categoryLabel === "bottom"
        ? "bg-amber-100 text-amber-700"
        : categoryLabel === "one piece"
          ? "bg-violet-100 text-violet-700"
          : "bg-slate-100 text-slate-700";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-opacity ${
        isAvailable ? "" : "opacity-60 grayscale"
      }`}
    >
      {/* Image */}
      {imgSrc ? (
        <div className="relative h-64 w-full bg-slate-50 flex items-center justify-center p-2">
          <img
            src={imgSrc}
            alt={item.name}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="relative flex h-64 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
          No photo
        </div>
      )}

      {/* Top left: category tag */}
      <span
        className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase shadow-sm ${categoryBadgeClass}`}
      >
        {item.category ?? "top"}
      </span>

      {/* Top right: round icon buttons */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onToggleAvailability(item)}
          className={`flex h-8 w-8 items-center justify-center rounded-full border bg-white/90 shadow-sm ${
            isAvailable
              ? "border-slate-200 text-slate-600 hover:bg-slate-100"
              : "border-amber-200 text-amber-600 hover:bg-amber-50"
          }`}
          title={isAvailable ? "Exclude from recommendations" : "Include in recommendations"}
          aria-label={isAvailable ? "Mark unavailable" : "Mark available"}
        >
          {isAvailable ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm hover:bg-slate-100"
          title="Edit"
          aria-label="Edit"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white/90 text-red-600 shadow-sm hover:bg-red-50"
          title="Delete"
          aria-label="Delete"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="mb-2">
          <h3 className={`text-base font-semibold ${isAvailable ? "text-slate-900" : "text-slate-500"}`}>
            {item.name}
          </h3>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {item.subCategory ? `${item.subCategory} · ${item.category}` : item.category}
          </span>
        </div>

        {(() => {
          const fitDisplay = item.fit?.trim() && item.fit !== "0" ? item.fit : null;
          const seasonsDisplay = item.seasons?.length ? item.seasons.join(", ") : null;
          const occasionsDisplay = item.occasions?.length ? item.occasions.join(", ") : null;
          const parts = [fitDisplay, seasonsDisplay, occasionsDisplay].filter(Boolean);
          return parts.length > 0 ? (
            <p className="text-xs text-slate-500">
              {parts.join(" · ")}
            </p>
          ) : null;
        })()}

        {item.colors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            {item.colors.map((c) => {
              const sc = swatchColor(c);
              return (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-1 pr-2 py-0.5 text-[11px] font-medium text-slate-700"
                >
                  {sc && (
                    <span
                      className="h-4 w-4 rounded-full border border-slate-300 shrink-0"
                      style={{ backgroundColor: sc }}
                      title={c}
                    />
                  )}
                  {c}
                </span>
              );
            })}
          </div>
        )}

        {item.pattern && (
          <p className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">Pattern:</span> {item.pattern}
          </p>
        )}

        {/* Rescue launch (§B/F2): build a full outfit around THIS item. Sends `forcedItemId` to the
            one recommend route (intent=rescue_item), so every suggestion includes this piece. */}
        {isAvailable && (
          <Link
            href={`/dashboard?rescue=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name)}`}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Build an outfit around this
          </Link>
        )}
      </div>
    </div>
  );
}

type WardrobeFormValues = Omit<WardrobeItem, "id">;

type AddItemModalProps = {
  onClose: () => void;
  /** Returns `false` (or an error-message string) when the save FAILED — the modal then stays open
   *  so the user's input is not lost (§I client-state gate), and a string is rendered as the
   *  in-modal error (the page-level banner is invisible behind the modal overlay). Any other
   *  result (success) closes the modal. */
  onSave: (
    item: WardrobeFormValues,
    imageFile: File | null,
  ) => Promise<boolean | string | void> | boolean | string | void;
  initialItem?: WardrobeFormValues;
  title?: string;
  /** Add flow: step 1 is upload-only, step 2 is form. When null, single form (edit or add without CV). */
  addStep?: "upload" | "form";
  pendingAddFile?: File | null;
  onAnalyze?: (file: File) => Promise<void>;
  isAnalyzing?: boolean;
  /** Error message from the most recent CV inference attempt, shown in the upload step. */
  cvError?: string | null;
  /** True when the CV service is not configured — the upload step then drops the dead "Analyze
   *  photo" CTA and makes manual entry the primary path. */
  cvUnavailable?: boolean;
  /** Called when the user wants to skip CV and go directly to the form. Receives the currently-selected file (may be null). */
  onSkipToForm?: (file: File | null) => void;
  /** When editing, show current image and make file input optional so we don't overwrite. */
  existingImagePath?: string | null;
};

export function AddItemModal({
  onClose,
  onSave,
  initialItem,
  title,
  addStep,
  pendingAddFile,
  onAnalyze,
  isAnalyzing,
  cvError,
  cvUnavailable,
  onSkipToForm,
  existingImagePath,
}: AddItemModalProps) {
  const [name, setName] = useState(initialItem?.name ?? "");
  // Empty default (not "top") so a new item forces a real Category choice — a silent "top" default
  // mis-slots shoes/jackets and corrupts the M6 corpus (validateWardrobeForm rejects "", so the
  // "Select a category…" placeholder makes the required marker actually bite). Edit keeps its value.
  const [category, setCategory] = useState(initialItem?.category ?? "");
  const [subCategory, setSubCategory] = useState(initialItem?.subCategory ?? "");
  const [colors, setColors] = useState<string[]>(initialItem?.colors ?? []);
  const [colorsInput, setColorsInput] = useState("");
  const [colorError, setColorError] = useState<string | null>(null);
  const [pattern, setPattern] = useState(initialItem?.pattern ?? "");
  const [layerRole, setLayerRole] = useState(initialItem?.layerRole ?? "");
  const [seasons, setSeasons] = useState<string[]>(initialItem?.seasons ?? []);
  const [occasions, setOccasions] = useState<string[]>(initialItem?.occasions ?? []);
  const [occasionsInput, setOccasionsInput] = useState("");
  const [fit, setFit] = useState(initialItem?.fit ?? "");
  const isAvailable = initialItem?.isAvailable ?? true;
  const [imageFile, setImageFile] = useState<File | null>(pendingAddFile ?? null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Synchronous re-entrancy latch. `disabled={saving}` only bites after React re-renders, so a
  // sub-frame double-tap (fast mobile taps, a synthetic double-click) can fire two submits before
  // the button disables — and the add path has NO server-side idempotency, so the second submit
  // mints a DUPLICATE wardrobe item, silently polluting the fresh Track 2 corpus. A ref flips
  // synchronously, before the first submit yields at its `await`, so the second is a no-op.
  const savingRef = useRef(false);
  const [guideDismissedSession, setGuideDismissedSession] = useState(false);
  const [guideDismissedForever, setGuideDismissedForever] = useState(false);

  const isUploadStep = addStep === "upload";
  const isEdit = !!existingImagePath || (!!initialItem && !addStep);
  const showForm = !isUploadStep;
  const canShowGuideInThisModal = showForm && addStep === "form";
  const showCvGuide =
    canShowGuideInThisModal &&
    !guideDismissedSession &&
    !guideDismissedForever;

  function toggleInArray(value: string, current: string[], setter: (v: string[]) => void) {
    if (current.includes(value)) setter(current.filter((v) => v !== value));
    else setter([...current, value]);
  }

  // When parent passes initialItem (e.g. after CV infer), sync into form state
  useEffect(() => {
    if (!initialItem || isUploadStep) return;
    setName(initialItem.name ?? "");
    setCategory(initialItem.category ?? "");
    setSubCategory(initialItem.subCategory ?? "");
    setColors(initialItem.colors ?? []);
    setPattern(initialItem.pattern ?? "");
    setLayerRole(initialItem.layerRole ?? "");
    setSeasons(initialItem.seasons ?? []);
    setOccasions(initialItem.occasions ?? []);
    setFit(initialItem.fit ?? "");
  }, [initialItem, isUploadStep]);

  useEffect(() => {
    if (pendingAddFile != null) setImageFile(pendingAddFile);
  }, [pendingAddFile]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(CV_GUIDE_DISMISS_FOREVER_KEY) === "1") {
        setGuideDismissedForever(true);
      }
    } catch {
      // Ignore localStorage access errors.
    }
  }, []);

  function onPickImage(file: File | null) {
    setImageError(null);
    if (!file) {
      setImageFile(null);
      return;
    }
    // Basic client-side checks (server will enforce too)
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) {
      setImageError(UNSUPPORTED_IMAGE_MSG);
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setImageError("Max image size is 5MB.");
      return;
    }
    setImageFile(file);
  }

  /** Accept a color NAME ("navy", "light blue") or a hex code — the server stores arbitrary color
   *  strings, and names read better in the stylist prompt than hex. An invalid entry must show a
   *  visible error, never silently no-op (the pre-fix behavior stranded users at "Add at least one
   *  color" with no way to satisfy it). */
  function addColor(raw: string) {
    const res = normalizeColor(raw);
    if (!res.ok) {
      if (res.error) setColorError(res.error);
      return;
    }
    setColorError(null);
    // Entry-time count cap — mirrors the server's 25-entry array bound so the reject happens at
    // the chip, not at save time.
    if (colors.length >= 25) {
      setColorError("That's plenty of colors — 25 is the limit.");
      return;
    }
    // Case-insensitive dedupe — CV-prefilled hex may be uppercase while new entries are lowercased.
    if (!colors.some((c) => c.toLowerCase() === res.value)) {
      setColors((prev: string[]) => [...prev, res.value]);
    }
    setColorsInput("");
  }

  function addOccasionTag(value: string) {
    const raw = value.trim();
    if (!raw) return;
    // Normalize simple separators like commas or multiple spaces
    const normalized = raw.replace(/\s+/g, " ");
    // Entry-time caps mirror the server's 60-char / 25-entry array bounds — reject at the chip
    // (with which chip named), not as a vague 400 at save time.
    if (normalized.length > 60) {
      setFormError(`"${normalized.slice(0, 24)}…" is too long for an occasion tag (60 characters max).`);
      return;
    }
    if (occasions.length >= 25) {
      setFormError("That's plenty of occasion tags — 25 is the limit.");
      return;
    }
    setFormError(null);
    if (!occasions.includes(normalized)) {
      setOccasions((prev: string[]) => [...prev, normalized]);
      setOccasionsInput("");
    }
  }

  function dismissGuideForever() {
    setGuideDismissedForever(true);
    try {
      window.localStorage.setItem(CV_GUIDE_DISMISS_FOREVER_KEY, "1");
    } catch {
      // Ignore localStorage write errors.
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitForm();
  }

  /** Reset the confirm-form back to a blank add state — used by "Save & add another" so a friend can
   *  enter their next item without re-opening the modal (the #1 yield-friction removal: 15 items no
   *  longer means 15 modal open/close cycles). Clears every field INCLUDING the photo, so the next
   *  item starts on the photo-first path (D1). Called from submitForm's success branch, just BEFORE
   *  the finally releases the savingRef latch — safe because this only touches form state, never the
   *  latch; a rapid follow-up tap is instead blocked by the now-empty name failing validation. */
  function resetFormForAddAnother() {
    setName("");
    setCategory("");
    setSubCategory("");
    setColors([]);
    setColorsInput("");
    setColorError(null);
    setPattern("");
    setLayerRole("");
    setSeasons([]);
    setOccasions([]);
    setOccasionsInput("");
    setFit("");
    setImageFile(null);
    setImageError(null);
    setFormError(null);
  }

  // Shared by the form's submit ("Save item", the primary button rendered ONLY when a photo is
  // attached) and the deliberate "Save without a photo" button. The D1 photo strong-nudge is
  // enforced by the FOOTER rendering — a photo-less save is reachable only via the honestly-labeled
  // secondary button (the no-photo footer has no submit button, so an Enter keypress can't slip a
  // photo-less item through) — so this just saves whatever state is present.
  async function submitForm(addAnother = false) {
    if (savingRef.current) return; // re-entrancy latch (see savingRef declaration) — no duplicate item
    setFormError(null);

    // Flush a pending color the user typed but didn't click "Add" — the #1 papercut: "red" sits in
    // the box, Save fails "Add at least one color" with no obvious cause. Reject a MALFORMED pending
    // color (don't silently drop it), but honor the count-cap/dedupe like addColor does.
    let colorsToSave = colors;
    const pendingColor = colorsInput.trim();
    if (pendingColor) {
      const res = normalizeColor(pendingColor);
      if (!res.ok) {
        // Route to formError (not colorError): this blocks the save from the FOOTER, so the message
        // renders next to the Save button (line ~955) AND in the Colors section (the includes("color")
        // path) — colorError alone renders only up in the scrolled body, re-hiding the very papercut
        // this fix targets. The guidance string contains "color", so both render sites light up.
        setFormError(res.error);
        return;
      }
      if (colors.length < 25 && !colors.some((c) => c.toLowerCase() === res.value)) {
        colorsToSave = [...colors, res.value];
      }
      setColors(colorsToSave);
      setColorsInput("");
    }

    // Same courtesy for a typed-but-un-added occasion (optional field — silent data loss otherwise).
    // An over-long pending tag blocks with the same message addOccasionTag uses, rather than vanishing.
    let occasionsToSave = occasions;
    const pendingOccasion = occasionsInput.trim().replace(/\s+/g, " ");
    if (pendingOccasion) {
      if (pendingOccasion.length > 60) {
        setFormError(`"${pendingOccasion.slice(0, 24)}…" is too long for an occasion tag (60 characters max).`);
        return;
      }
      if (occasions.length < 25 && !occasions.includes(pendingOccasion)) {
        occasionsToSave = [...occasions, pendingOccasion];
      }
      setOccasions(occasionsToSave);
      setOccasionsInput("");
    }

    const validation = validateWardrobeForm({ name, category, subCategory, colors: colorsToSave });
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    // imageFile is the single source of truth (mount-initialized from pendingAddFile + synced), so
    // Change/Remove in the confirm form actually take effect.
    const fileToUpload = imageFile;

    savingRef.current = true; // engaged only after validation passes, so a failed validate never locks
    setSaving(true);
    try {
      const result = await onSave(
        {
          name: name.trim(),
          category,
          subCategory: subCategory || undefined,
          // Edit mode sends "" (an explicit clear) — `undefined` is dropped by JSON.stringify, so
          // a mis-set pattern/layerRole could otherwise never be cleared via the PATCH.
          pattern: isEdit ? pattern.trim() : pattern.trim() || undefined,
          colors: colorsToSave,
          layerRole: isEdit ? layerRole : layerRole || undefined,
          fit: fit.trim(),
          size: "",
          seasons,
          occasions: occasionsToSave,
          notes: "",
          isAvailable,
        },
        fileToUpload
      );
      // Close ONLY on success — a failed save keeps the modal open so the input is not lost. A
      // string result is the server-failure message, shown INSIDE the modal (the page banner sits
      // behind the overlay).
      if (typeof result === "string") {
        setFormError(result);
        return;
      }
      // Success. "Save & add another" clears the form and keeps the modal open; a normal save closes.
      // After the reset the name is empty, so a rapid second add-another tap is validation-blocked
      // (never a dup); an in-flight second tap was already a no-op via savingRef above.
      if (result !== false) {
        if (addAnother) resetFormForAddAnother();
        else onClose();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Step 1: Add flow — upload photo only
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    // Hold the picked photo as a base64 data URL (a plain string in React state), NOT a `blob:`
    // object URL. On iOS WebKit — Safari AND Chrome — backgrounding the tab reclaims the blob backing
    // an object URL while keeping JS state, so a blob-URL <img> silently goes blank when a friend
    // switches tabs mid-add (to check a message / look up a color name). A data URL survives exactly
    // like the form's text fields do, so the preview no longer vanishes. (A FULL iOS tab discard on a
    // long background still resets everything; that is a separate draft-persistence concern, not this
    // blob-reclaim bug.)
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled) setPreviewUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => {
      if (!cancelled) setPreviewUrl(null);
    };
    reader.readAsDataURL(imageFile);
    return () => {
      cancelled = true;
    };
  }, [imageFile]);

  // ── Photo (confirm form). Single source of truth is `imageFile` (mount-initialized from
  //    pendingAddFile + synced), so Change/Remove operate on it directly. In edit mode the stored
  //    image is kept when no new file is picked. `willHavePhoto` drives the D1 strong-nudge: a
  //    photo-less save must be a deliberate, honestly-labeled action, never the default.
  const existingPhotoUrl = isEdit ? imageUrlFromPath(existingImagePath ?? undefined) : null;
  const photoPreviewSrc = previewUrl ?? existingPhotoUrl;
  const willHavePhoto = !!imageFile || (isEdit && !!existingImagePath);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const triggerPicker = () => fileInputRef.current?.click();

  if (isUploadStep) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Add clothing item</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              aria-label="Close"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            {cvUnavailable
              ? "Add a clear photo of the item, then fill in a few quick details."
              : "Upload a photo and we’ll suggest category, colors, and more — or skip and fill in the details manually."}
          </p>
          <div
            className={`relative rounded-xl border-2 border-dashed transition-colors ${
              dragOver ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-slate-50/50"
            } ${isAnalyzing ? "pointer-events-none opacity-80" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && /^image\/(jpeg|png|webp)$/i.test(f.type)) onPickImage(f);
              else setImageError(UNSUPPORTED_IMAGE_MSG);
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
              disabled={!!isAnalyzing}
            />
            {previewUrl ? (
              <div className="flex flex-col items-center justify-center p-6">
                <img src={previewUrl} alt="Preview" className="max-h-48 w-auto rounded-lg object-contain shadow-inner bg-white" />
                <p className="mt-2 text-xs text-slate-500">{imageFile?.name}</p>
                <p className="text-xs text-slate-400">Tap to choose a different photo</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-sm font-medium text-slate-600">Drop a photo here or click to browse</p>
                <p className="text-xs text-slate-400 mt-0.5">JPEG, PNG or WEBP · max 5MB</p>
              </div>
            )}
          </div>
          {imageError && <p className="mt-2 text-xs text-red-600">{imageError}</p>}
          <AddItemUploadStepActions
            imageFile={imageFile}
            isAnalyzing={isAnalyzing}
            cvError={cvError}
            cvUnavailable={cvUnavailable}
            onClose={onClose}
            onAnalyze={onAnalyze}
            onSkipToForm={onSkipToForm}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative flex w-full max-w-lg items-start justify-center">
        {showCvGuide && (
          <aside className="hidden lg:block absolute right-full mr-4 top-4 w-80 rounded-xl border border-slate-200/70 bg-sky-50/95 p-4 shadow-xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Quick guide</h4>
            </div>
            <ul className="space-y-2 text-xs leading-5 text-slate-700">
              <li>
                <span className="font-semibold text-slate-900">Photo &amp; colors matter most:</span> a clear photo is what the style-matching experiment measures, and the real colors (with the name and type) power the recommendations.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Category &amp; type:</span> pick the closest match — it sets how outfits are built. For a jacket or coat, set Layer role to Outer.
              </li>
              <li>
                <span className="font-semibold text-slate-900">Occasions / contexts:</span> add how you actually wear it (e.g. gym, office, date night) to sharpen recommendations.
              </li>
            </ul>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setGuideDismissedSession(true)}
                className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={dismissGuideForever}
                className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
              >
                Dismiss forever
              </button>
            </div>
          </aside>
        )}

      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 p-5 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {addStep === "form" && pendingAddFile && (() => {
              const url = previewUrl ?? "";
              return url ? (
                <button
                  type="button"
                  onClick={() => setEnlarged(true)}
                  className="shrink-0 rounded-lg"
                  aria-label="Enlarge photo"
                >
                  <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200 cursor-zoom-in" />
                </button>
              ) : null;
            })()}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 truncate">
                {title ?? "Add clothing item"}
              </h2>
              {addStep === "form" && pendingAddFile && (
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="text-xs text-slate-500">Review and edit, then save</p>
                  {!showCvGuide && canShowGuideInThisModal && (
                    <button
                      type="button"
                      onClick={() => {
                        setGuideDismissedSession(false);
                        setGuideDismissedForever(false);
                        try {
                          window.localStorage.removeItem(CV_GUIDE_DISMISS_FOREVER_KEY);
                        } catch {
                          // Ignore localStorage access errors.
                        }
                      }}
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Show guide
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0"
            aria-label="Close"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        {enlarged && photoPreviewSrc && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
            onClick={() => setEnlarged(false)}
            role="button"
            aria-label="Close enlarged photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoPreviewSrc}
              alt="Item photo enlarged"
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="p-5 overflow-y-auto space-y-5">
            {showCvGuide && (
              <aside className="lg:hidden rounded-xl border border-slate-200/70 bg-sky-50/80 p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">Quick guide</h4>
                </div>
                <ul className="space-y-2 text-xs leading-5 text-slate-700">
                  <li>
                    <span className="font-semibold text-slate-900">Photo &amp; colors matter most:</span> a clear photo is what the style-matching experiment measures, and the real colors (with the name and type) power the recommendations.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">Category &amp; type:</span> pick the closest match — it sets how outfits are built. For a jacket or coat, set Layer role to Outer.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">Occasions / contexts:</span> add how you actually wear it (e.g. gym, office, date night) to sharpen recommendations.
                  </li>
                </ul>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setGuideDismissedSession(true)}
                    className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={dismissGuideForever}
                    className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
                  >
                    Dismiss forever
                  </button>
                </div>
              </aside>
            )}
            {/* Basics */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Basics</h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 transition-shadow"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Blue denim jacket"
                  maxLength={200}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a category…
                    </option>
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Colors */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Colors <span className="normal-case tracking-normal font-normal text-slate-400">— optional, helps the stylist explain outfits</span>
              </h3>
              {colors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {colors.map((c: string) => {
                    const sc = swatchColor(c);
                    const isHex = /^#[0-9A-Fa-f]{6}$/.test(c);
                    return (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 pl-1 pr-2 py-1 bg-white shadow-sm"
                      >
                        {sc && (
                          <span
                            className="h-5 w-5 rounded-full border border-slate-200 shrink-0"
                            style={{ backgroundColor: sc }}
                            title={c}
                          />
                        )}
                        <span className={`text-xs text-slate-700 ${isHex ? "font-mono" : ""}`}>{c}</span>
                        <button
                          type="button"
                          onClick={() => setColors((prev: string[]) => prev.filter((x: string) => x !== c))}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                          aria-label={`Remove color ${c}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {formError && formError.includes("color") && (
                <p className="text-xs text-red-600">{formError}</p>
              )}
              {colorError && <p className="text-xs text-red-600">{colorError}</p>}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                  placeholder='Add a color (e.g. "navy" or #382828)'
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addColor(colorsInput))}
                />
                <button
                  type="button"
                  onClick={() => addColor(colorsInput)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Add
                </button>
              </div>
            </section>

            {/* Layer role stays primary — it is the one explicit user knob over the outfit slot
                (layerRole="outer" files the item as outer_layer; lib/clothingType.ts), and the
                Category dropdown has no "Outerwear" value, so it is the correct filing path for a
                jacket/coat. Pattern + Fit are stored-but-unused by the recommender today, so they
                collapse under an optional <details> that keeps them MOUNTED — they still submit in
                the wire shape (D2 invariant), the friend just isn't asked to fill dead fields. */}
            <section className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Layer role</label>
                <select
                  aria-label="Layer role"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={layerRole}
                  onChange={(e) => setLayerRole(e.target.value)}
                >
                  <option value="">None / Not applicable</option>
                  <option value="base">Base layer (e.g. tee, shirt)</option>
                  <option value="mid">Mid layer (e.g. sweater)</option>
                  <option value="outer">Outer layer (e.g. jacket, coat)</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Jacket, coat, or blazer? Set this to <span className="font-medium">Outer layer</span> so it&apos;s matched as outerwear.
                </p>
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50/50">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600">
                  More details (optional)
                </summary>
                <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Pattern</label>
                    <select
                      aria-label="Pattern"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {PATTERN_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Fit</label>
                    <select
                      aria-label="Fit"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                      value={fit}
                      onChange={(e) => setFit(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {FIT_OPTIONS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>
            </section>

            {/* When & where */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">When & where</h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Seasons</label>
                <div className="flex flex-wrap gap-1.5">
                  {SEASON_OPTIONS.map((s) => {
                    const active = seasons.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleInArray(s, seasons, setSeasons)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Occasions / contexts</label>
                {occasions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {occasions.map((o) => (
                      <span
                        key={o}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                      >
                        <span>{o}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setOccasions((prev: string[]) => prev.filter((val: string) => val !== o))
                          }
                          className="text-slate-400 hover:text-red-600 transition-colors"
                          aria-label={`Remove occasion ${o}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                    value={occasionsInput}
                    onChange={(e) => setOccasionsInput(e.target.value)}
                    placeholder='Add occasion tag (e.g. "date night", "business casual")'
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addOccasionTag(occasionsInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => addOccasionTag(occasionsInput)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Photo</h3>
              {willHavePhoto ? (
                <div className="space-y-2">
                  {photoPreviewSrc && (
                    <button
                      type="button"
                      onClick={() => setEnlarged(true)}
                      className="block rounded-lg border border-slate-200 bg-white p-1 hover:border-slate-300 transition-colors"
                      aria-label="Enlarge photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoPreviewSrc}
                        alt="Item photo"
                        className="max-h-56 w-auto rounded object-contain cursor-zoom-in"
                      />
                    </button>
                  )}
                  <div className="flex items-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={triggerPicker}
                      className="font-medium text-slate-700 hover:text-slate-900 transition-colors"
                    >
                      Change photo
                    </button>
                    {!!imageFile && (
                      <button
                        type="button"
                        onClick={() => setImageFile(null)}
                        className="text-slate-500 hover:text-red-600 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                    <span className="text-xs text-slate-400">Tap the photo to enlarge</span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={triggerPicker}
                  className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center hover:border-slate-400 hover:bg-slate-50 transition-colors"
                >
                  <span className="block text-sm font-medium text-slate-800">+ Add a photo</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    The photo is the important part — it&apos;s what this little project actually studies.
                    Your recommendations run on the details you type in, so an item without a photo still
                    works — it just won&apos;t help the study.
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  onPickImage(e.target.files?.[0] ?? null);
                  e.target.value = ""; // allow re-picking the same file name
                }}
              />
              {imageError && <p className="text-xs text-red-600">{imageError}</p>}
            </section>
          </div>

          <div className="p-5 pt-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl shrink-0">
            {formError && (
              <p className="text-sm text-red-600 mb-3">{formError}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              {willHavePhoto ? (
                <>
                  {/* Add-flow only (never edit): save this item and reset to a blank form WITHOUT
                      re-opening the modal — the #1 yield-friction removal for a 15-item closet. Only
                      on the photo-first path, so the streamlined loop keeps photos the default. */}
                  {!isEdit && (
                    <button
                      type="button"
                      onClick={() => submitForm(true)}
                      disabled={saving}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving…" : "Save & add another"}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {saving && (
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    {saving ? "Saving…" : "Save item"}
                  </button>
                </>
              ) : (
                <>
                  {/* D1: the photo-less save is the low-emphasis, honestly-labeled path; "Add a photo"
                      is the primary affordance. */}
                  <button
                    type="button"
                    onClick={() => submitForm()}
                    disabled={saving}
                    title="This item won't count toward the style-matching experiment"
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : "Save without a photo"}
                  </button>
                  <button
                    type="button"
                    onClick={triggerPicker}
                    disabled={saving}
                    className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    Add a photo
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}

/** Downscale a photo client-side before upload. Two hard reasons: Vercel rejects request bodies
 *  over ~4.5MB at the platform edge (the route's own 5MB check never runs in production), and
 *  images live as base64 in a 512MB Atlas M0 — full-size phone photos would exhaust it within a
 *  few closets. Longest edge 1280px; JPEG q0.85 (PNG stays PNG to preserve CV-crop transparency).
 *  Falls back to the original file on any decode/canvas failure. */
async function prepareImageForUpload(file: File): Promise<File> {
  const SKIP_BELOW_BYTES = 400 * 1024; // already small — don't re-encode
  const MAX_EDGE_PX = 1280;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    // imageOrientation honors EXIF rotation (phone photos); fall back where unsupported.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
      createImageBitmap(file),
    );
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close(); // release the decoded bitmap promptly (large phone photos)
    const isPng = file.type === "image/png";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", isPng ? undefined : 0.85),
    );
    if (!blob || blob.size >= file.size) return file; // re-encode didn't help — keep the original
    const newName = isPng ? file.name : file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: blob.type });
  } catch {
    return file;
  }
}

async function uploadWardrobeItemImage(params: {
  firebaseUser: FirebaseUser;
  wardrobeItemId: string;
  file: File;
}) {
  const token = await params.firebaseUser.getIdToken();

  const file = await prepareImageForUpload(params.file);
  if (file.size > 4 * 1024 * 1024) {
    // Vercel's platform body cap (~4.5MB) would kill the request with an opaque non-JSON 413 —
    // fail here with an actionable message instead.
    throw new Error("That photo is too large even after compression — try a smaller image.");
  }

  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`/api/wardrobe/${params.wardrobeItemId}/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // DO NOT set Content-Type for FormData
    },
    body: fd,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to upload image");
  return data; // { ok: true, imagePath: "mongo:..." }
}

export default function WardrobePage() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Add flow: step 1 = upload only, step 2 = form with CV-inferred attributes
  const [addStep, setAddStep] = useState<"upload" | "form" | null>(null);
  const [addInferred, setAddInferred] = useState<WardrobeFormValues | null>(null);
  const [addInferredCroppedImage, setAddInferredCroppedImage] = useState<string | null>(null);
  const [addPendingFile, setAddPendingFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  // Distinct from cvError (which is also set on a transient inference failure): true when the CV
  // service is not configured at all, so the upload step drops the dead "Analyze photo" CTA and makes
  // manual entry the primary path (CV is off in production — the W-track replacement isn't built).
  // F6 — default TRUE (honest): CV is off in prod, so the manual-entry copy shows immediately rather
  // than promising "we'll suggest category/colors" for the ~1s until the /api/cv/status probe returns.
  // The probe flips it to false only if CV is genuinely available (the W-track future).
  const [cvUnavailable, setCvUnavailable] = useState(true);
  const cvAbortRef = useRef<AbortController | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "top" | "bottom" | "one piece" | "footwear">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");

  // Watch Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setFirebaseUser(null);
        setItems([]);
        setError("You are not signed in. Please sign in again.");
      } else {
        setFirebaseUser(user);
        setError(null);
      }
    });
    return () => unsub();
  }, []);

  // Fetch wardrobe items when userId is available
  useEffect(() => {
    async function fetchItems() {
      if (!firebaseUser) return;
      try {
        setLoading(true);
        setError(null);
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/wardrobe", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Failed to load wardrobe.");
          return;
        }
        type WardrobeItemApi = WardrobeItem & { _id?: string; id?: string };

        const normalized = (data.items ?? []).map((it: WardrobeItemApi) => ({
          ...it,
          id: it.id ?? it._id ?? it.id, // id should exist after this
        }));
        setItems(normalized);
      } catch (e) {
        console.error("Error loading wardrobe:", e);
        setError("Failed to load wardrobe.");
      } finally {
        setLoading(false);
      }
    }

    fetchItems();
  }, [firebaseUser]);

  async function handleDeleteItem(item: WardrobeItem) {
    if (!firebaseUser) return;
    // Deletion is permanent (the photo goes too, unless an outfit-history snapshot still references
    // it — the D2 retention carve-out) and the trash button sits a fat-finger away from Edit —
    // confirm, same as Delete-all.
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      setError(null);
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/wardrobe/${item.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to delete item.");
        return;
      }
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (e) {
      console.error("Error deleting wardrobe item:", e);
      setError("Failed to delete item.");
    }
  }

  async function handleToggleAvailability(item: WardrobeItem) {
    if (!firebaseUser) return;
    try {
      setError(null);
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/wardrobe/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isAvailable: !(item.isAvailable ?? true) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to update availability.");
        return;
      }
      const raw = data.item;
      const updated: WardrobeItem = {
        ...raw,
        id: raw.id ?? raw._id,
        // Preserve createdAt from existing state if PATCH response omits it
        createdAt: raw.createdAt ?? item.createdAt,
      };
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (e) {
      console.error("Error updating availability:", e);
      setError("Failed to update availability.");
    }
  }

  /** Returns the saved item, or an error-message STRING on failure — the caller feeds the string
   *  back to the modal (the page banner is hidden behind the modal overlay, so a null-style
   *  failure was invisible mid-save). */
  async function handleAddItem(
    newItem: Omit<WardrobeItem, "id">,
  ): Promise<WardrobeItem | string> {
    if (!firebaseUser) {
      const msg = "You are not signed in. Please sign in again.";
      setError(msg);
      return msg;
    }

    try {
      setError(null);
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/wardrobe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newItem),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error ?? "Failed to save item.";
        setError(msg);
        return msg;
      }

      const raw = data.item;
      const saved: WardrobeItem = { ...raw, id: raw.id ?? raw._id };

      if (!saved.id) {
        const msg = "Item saved but server did not return an id.";
        setError(msg);
        return msg;
      }

      setItems((prev) => [saved, ...prev]);
      return saved;
    } catch (e) {
      console.error("Error saving wardrobe item:", e);
      const msg = "Failed to save item.";
      setError(msg);
      return msg;
    }
  }

  // Memoized: the modal's sync effect keys on this object's IDENTITY, and a fresh inline object on
  // every parent re-render made any parent setState while the edit modal was open (notably the
  // failed-save setError) re-run that effect and RESET the form to the original values — silently
  // discarding the user's edits while the modal claimed to preserve them (§I client-state gate).
  const modalInitialItem = useMemo<WardrobeFormValues | undefined>(() => {
    if (editingItem) {
      return {
        name: editingItem.name,
        category: editingItem.category,
        subCategory: editingItem.subCategory,
        pattern: editingItem.pattern,
        colors: editingItem.colors,
        layerRole: editingItem.layerRole,
        fit: editingItem.fit ?? "",
        size: editingItem.size,
        seasons: editingItem.seasons ?? [],
        occasions: editingItem.occasions ?? [],
        notes: editingItem.notes,
        isAvailable: editingItem.isAvailable,
        imagePath: editingItem.imagePath,
      };
    }
    return addStep === "form" ? addInferred ?? undefined : undefined;
  }, [editingItem, addStep, addInferred]);

  async function handleClearAll() {
    if (!firebaseUser) return;
    if (!confirm("Delete ALL wardrobe items? This cannot be undone.")) return;
    try {
      setError(null);
      setClearing(true);
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/wardrobe/clear", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to clear wardrobe.");
        return;
      }
      setItems([]);
    } catch (e) {
      console.error("Error clearing wardrobe:", e);
      setError("Failed to clear wardrobe.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Wardrobe</h1>
          <p className="mt-1 text-sm text-slate-600">
            Add pieces from your closet so we can start building outfits.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            For the style-matching experiment, aim for ~15 items with photos — a couple of each type (tops, bottoms, shoes, outerwear).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={!firebaseUser || loading || clearing || items.length === 0}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {clearing ? "Deleting…" : "Delete all"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingItem(null);
              setAddStep("upload");
              setAddInferred(null);
              setAddPendingFile(null);
              setIsAnalyzing(false);
              setCvError(null);
              setCvUnavailable(true); // F6 — fail-closed to the honest manual-entry copy until proven otherwise
              cvAbortRef.current?.abort();
              cvAbortRef.current = null;
              setIsModalOpen(true);
              // Probe CV service in the background — flip to the "we'll suggest…" copy ONLY if it is
              // genuinely available; otherwise leave the honest manual-entry copy in place (no flash of
              // a promise we can't keep while CV is off in production).
              fetch("/api/cv/status")
                .then((r) => r.json())
                .then((data: { available?: boolean; reason?: string }) => {
                  if (data.available) {
                    setCvUnavailable(false);
                    setCvError(null);
                  } else {
                    // Honest copy: "temporarily" was a false promise while CV is not configured
                    // at all (the W-track replacement isn't built yet) — never fake a comeback.
                    setCvUnavailable(true);
                    setCvError(
                      data.reason === "not_configured"
                        ? "Photo analysis isn't set up yet — fill in the details yourself (about 30 seconds)."
                        : "Image analysis is temporarily unavailable. You can continue by filling the form manually."
                    );
                  }
                })
                .catch(() => {/* silently ignore — the honest manual-entry copy already stands */});
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Add item
          </button>
        </div>
      </div>
      

      {error && (
        <p className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Display-only controls — search, type filter, sort. No effect on recommendations. */}
      {!loading && items.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* Search */}
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wardrobe by item name"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />

          {/* Type filter pills + sort dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { label: "All", value: "all" },
                { label: "Tops", value: "top" },
                { label: "Bottoms", value: "bottom" },
                { label: "One-piece", value: "one piece" },
                { label: "Footwear", value: "footwear" },
              ] as { label: string; value: typeof activeFilter }[]
            ).map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveFilter(value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeFilter === value
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
              className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {(() => {
        // Pipeline: type filter → name search → sort → render (lib/wardrobeDisplayPipeline).
        // None of these touch backend state or recommendation APIs.
        const display = applyWardrobePipeline(items, activeFilter, searchQuery, sortOrder);

        if (loading) {
          return <p className="text-sm text-slate-500">Loading wardrobe…</p>;
        }
        if (items.length === 0) {
          return (
            <p className="text-sm text-slate-500">
              You don&apos;t have any items yet. Start by adding a few key pieces
              you wear often (jeans, t‑shirts, jackets, shoes) — and one piece you
              never quite know how to wear.
            </p>
          );
        }
        if (display.length === 0) {
          return (
            <p className="text-sm text-slate-500">
              No items match your search.
            </p>
          );
        }
        return (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {display.map((item) => (
              <WardrobeCard
                key={item.id}
                item={item}
                onEdit={(it) => {
                  setEditingItem(it);
                  setAddStep(null);
                  setAddInferred(null);
                  setAddPendingFile(null);
                  setIsModalOpen(true);
                }}
                onDelete={handleDeleteItem}
                onToggleAvailability={handleToggleAvailability}
              />
            ))}
          </div>
        );
      })()}

      {isModalOpen && (
        <AddItemModal
          onClose={() => {
            setIsModalOpen(false);
            setAddStep(null);
            setAddInferred(null);
            setAddPendingFile(null);
            setAddInferredCroppedImage(null);
            setEditingItem(null);
            setCvError(null);
          }}
          onSave={async (data, imageFile) => {
            if (editingItem) {
              if (!firebaseUser) {
                setError("You are not signed in. Please sign in again.");
                return "You are not signed in. Please sign in again.";
              }
              try {
                setError(null);
                const token = await firebaseUser.getIdToken();
                const res = await fetch(`/api/wardrobe/${editingItem.id}`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(data),
                });
                const respData = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const msg = respData.error ?? "Failed to update item.";
                  setError(msg);
                  return msg; // shown in-modal; the page banner is behind the overlay
                }
                const raw = respData.item;
                let updated: WardrobeItem = {
                  ...raw,
                  id: raw.id ?? raw._id,
                  // Preserve createdAt from existing state if PATCH response omits it
                  createdAt: raw.createdAt ?? editingItem.createdAt,
                };
                if (!updated.id) {
                  const msg = "Update succeeded but server did not return an id.";
                  setError(msg);
                  return msg;
                }
                // Preserve existing image if user did not upload a new one
                if (!imageFile) {
                  updated = { ...updated, imagePath: editingItem.imagePath ?? updated.imagePath };
                } else if (firebaseUser) {
                  try {
                    const up = await uploadWardrobeItemImage({
                      firebaseUser,
                      wardrobeItemId: updated.id,
                      file: imageFile,
                    });
                    updated = { ...updated, imagePath: up.imagePath };
                  } catch (e) {
                    console.error(e);
                    // The item edit itself succeeded — say so, or "try again" reads as re-do-the-edit.
                    const msg = e instanceof Error ? e.message : "Failed to upload image.";
                    setError(`${msg} — your item changes were saved; retry the photo from Edit.`);
                  }
                }
                setItems((prev) =>
                  prev.map((it) => (it.id === updated.id ? updated : it))
                );
                // Success — the modal's onClose (below) clears editingItem. On any failure above we
                // returned the error MESSAGE so the modal stays open, shows it, and preserves the
                // edited values.
              } catch (e) {
                console.error("Error updating wardrobe item:", e);
                setError("Failed to update item.");
                return "Failed to update item.";
              }
            } else {
              const saved = await handleAddItem(data);
              // Save failed — return the message so the MODAL shows it (stays open, form preserved).
              if (typeof saved === "string") return saved;
              if (firebaseUser) {
                try {
                  // Use the CV-cropped image ONLY when the friend kept the original photo. If they
                  // Removed it (imageFile null) or Changed it in the confirm form (a different File),
                  // the crop is stale and honoring it would override a deliberate choice — save what
                  // they actually chose instead. (Dormant today: CV is off, so no crop; guards the
                  // W-track future where /api/cv/infer returns crops.)
                  if (addInferredCroppedImage && imageFile === addPendingFile) {
                    // Use CV-cropped, background-removed image returned by the CV service
                    const base64 = addInferredCroppedImage;
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                      bytes[i] = binary.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: "image/png" });
                    const cvFile = new File([blob], "cv-cropped.png", { type: "image/png" });
                    const up = await uploadWardrobeItemImage({
                      firebaseUser,
                      wardrobeItemId: saved.id,
                      file: cvFile,
                    });
                    setItems((prev) =>
                      prev.map((it) => (it.id === saved.id ? { ...it, imagePath: up.imagePath } : it))
                    );
                  } else if (imageFile) {
                    // Fallback: use the original uploaded image if CV did not return a cropped version
                    const up = await uploadWardrobeItemImage({
                      firebaseUser,
                      wardrobeItemId: saved.id,
                      file: imageFile,
                    });
                    setItems((prev) =>
                      prev.map((it) => (it.id === saved.id ? { ...it, imagePath: up.imagePath } : it))
                    );
                  }
                } catch (e) {
                  console.error(e);
                  // The item itself WAS created — without saying so, "try again" reads as re-add
                  // the item, which mints a duplicate during exactly the batch-onboarding flow.
                  const msg = e instanceof Error ? e.message : "Failed to upload image.";
                  setError(`${msg} — the item itself was saved; add its photo from Edit.`);
                }
              }
              setAddStep(null);
              setAddInferred(null);
              setAddPendingFile(null);
              setAddInferredCroppedImage(null);
            }
          }}
          initialItem={modalInitialItem}
          title={editingItem ? "Edit clothing item" : addStep === "form" ? "Confirm & save item" : "Add clothing item"}
          addStep={editingItem ? undefined : addStep ?? undefined}
          pendingAddFile={addPendingFile}
          onAnalyze={async (file: File) => {
            cvAbortRef.current?.abort();
            const controller = new AbortController();
            cvAbortRef.current = controller;
            setIsAnalyzing(true);
            setCvError(null);
            setError(null);
            try {
              const fd = new FormData();
              fd.append("file", file);
              const token = await firebaseUser?.getIdToken();
              const res = await fetch("/api/cv/infer", {
                method: "POST",
                body: fd,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                signal: controller.signal,
              });
              if (controller.signal.aborted) return;
              const json = await res.json().catch(() => ({}));
              if (controller.signal.aborted) return;
              if (!res.ok) {
                // Use the structured message from the route when available
                const msg = (json as { message?: string; error?: string }).message
                  ?? (json as { error?: string }).error
                  ?? "Image analysis failed. You can continue by filling the form manually.";
                setCvError(msg);
                return;
              }
              const full = json as CVInferResponse & { cropped_image_base64?: string | null };
              setAddInferred(cvResponseToFormValues(full));
              const cropped = typeof full.cropped_image_base64 === "string" ? full.cropped_image_base64 : null;
              setAddInferredCroppedImage(cropped);
              setAddPendingFile(file);
              setAddStep("form");
            } catch (e) {
              if ((e as Error)?.name === "AbortError") return;
              console.error(e);
              setCvError(e instanceof Error ? e.message : "Image analysis failed. You can continue by filling the form manually.");
            } finally {
              if (!controller.signal.aborted) {
                cvAbortRef.current = null;
              }
              setIsAnalyzing(false);
            }
          }}
          isAnalyzing={isAnalyzing}
          cvError={cvError}
          cvUnavailable={cvUnavailable}
          onSkipToForm={(file) => {
            setAddInferred(null);
            setAddPendingFile(file);
            setAddStep("form");
            setCvError(null);
          }}
          existingImagePath={editingItem?.imagePath}
        />
      )}
    </div>
  );
}
