/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { cvResponseToFormValues, type CVInferResponse } from "@/lib/cvToWardrobeForm";
import { AddItemUploadStepActions } from "@/lib/addItemUploadStepActions";
import { validateWardrobeForm } from "@/lib/wardrobeValidation";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";

type WardrobeItem = {
  id: string;
  name: string;
  clothingType?: "top" | "bottom";
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
              const isHex = /^#[0-9A-Fa-f]{6}$/.test(c);
              return (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-1 pr-2 py-0.5 text-[11px] font-medium text-slate-700"
                >
                  {isHex && (
                    <span
                      className="h-4 w-4 rounded-full border border-slate-300 shrink-0"
                      style={{ backgroundColor: c }}
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
      </div>
    </div>
  );
}

type WardrobeFormValues = Omit<WardrobeItem, "id">;

type AddItemModalProps = {
  onClose: () => void;
  onSave: (item: WardrobeFormValues, imageFile: File | null) => Promise<void> | void;
  initialItem?: WardrobeFormValues;
  title?: string;
  /** Add flow: step 1 is upload-only, step 2 is form. When null, single form (edit or add without CV). */
  addStep?: "upload" | "form";
  pendingAddFile?: File | null;
  onAnalyze?: (file: File) => Promise<void>;
  isAnalyzing?: boolean;
  /** Error message from the most recent CV inference attempt, shown in the upload step. */
  cvError?: string | null;
  /** Called when the user wants to skip CV and go directly to the form. Receives the currently-selected file (may be null). */
  onSkipToForm?: (file: File | null) => void;
  /** When editing, show current image and make file input optional so we don't overwrite. */
  existingImagePath?: string | null;
};

function AddItemModal({
  onClose,
  onSave,
  initialItem,
  title,
  addStep,
  pendingAddFile,
  onAnalyze,
  isAnalyzing,
  cvError,
  onSkipToForm,
  existingImagePath,
}: AddItemModalProps) {
  const [name, setName] = useState(initialItem?.name ?? "");
  const [category, setCategory] = useState(initialItem?.category ?? "top");
  const [subCategory, setSubCategory] = useState(initialItem?.subCategory ?? "");
  const [colors, setColors] = useState<string[]>(initialItem?.colors ?? []);
  const [colorsInput, setColorsInput] = useState("");
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
    setCategory(initialItem.category ?? "top");
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
      setImageError("Only JPEG, PNG, or WEBP images are allowed.");
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setImageError("Max image size is 5MB.");
      return;
    }
    setImageFile(file);
  }

  function addColor(hex: string) {
    const h = hex.trim();
    if (!h) return;
    const normalized = /^#[0-9A-Fa-f]{6}$/.test(h) ? h : /^[0-9A-Fa-f]{6}$/.test(h) ? `#${h}` : null;
    if (normalized && !colors.includes(normalized)) {
      setColors((prev: string[]) => [...prev, normalized]);
      setColorsInput("");
    }
  }

  function addOccasionTag(value: string) {
    const raw = value.trim();
    if (!raw) return;
    // Normalize simple separators like commas or multiple spaces
    const normalized = raw.replace(/\s+/g, " ");
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
    setFormError(null);
    const validation = validateWardrobeForm({ name, category, subCategory, colors });
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const colorsToSave = colors;
    const fileToUpload = isEdit ? null : (addStep === "form" ? pendingAddFile ?? imageFile : imageFile);

    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          category,
          subCategory: subCategory || undefined,
          pattern: pattern.trim() || undefined,
          colors: colorsToSave,
          layerRole: layerRole || undefined,
          fit: fit.trim(),
          size: "",
          seasons,
          occasions,
          notes: "",
          isAvailable,
        },
        fileToUpload
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Step 1: Add flow — upload photo only
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageFile) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

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
          <p className="mb-4 text-sm text-slate-600">Upload a photo and we&apos;ll suggest category, colors, and more — or skip and fill in the details manually.</p>
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
              else setImageError("Please use a JPEG, PNG, or WEBP image.");
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
                <span className="text-3xl text-slate-300 mb-2">📷</span>
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
                <span className="font-semibold text-slate-900">CV may be wrong:</span> photo recognition is a draft, always verify category, type, and colors before saving
              </li>
              <li>
                <span className="font-semibold text-slate-900">Check Layer role:</span> set base, mid, or outer so outfit matching handles stacking correctly
              </li>
              <li>
                <span className="font-semibold text-slate-900">Use Occasions / contexts:</span> add how you usually wear this piece (e.g. gym, office, date night) to improve recommendations
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
                <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200 shrink-0" />
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

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="p-5 overflow-y-auto space-y-5">
            {showCvGuide && (
              <aside className="lg:hidden rounded-xl border border-slate-200/70 bg-sky-50/80 p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">Quick guide</h4>
                </div>
                <ul className="space-y-2 text-xs leading-5 text-slate-700">
                  <li>
                    <span className="font-semibold text-slate-900">CV may be wrong:</span> photo recognition is a draft, always verify category, type, and colors before saving
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">Check Layer role:</span> set base, mid, or outer so outfit matching handles stacking correctly
                  </li>
                  <li>
                    <span className="font-semibold text-slate-900">Use Occasions / contexts:</span> add how you usually wear this piece (e.g. gym, office, date night) to improve recommendations
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
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type *</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    required
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Colors *</h3>
              {colors.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {colors.map((hex: string) => (
                    <span
                      key={hex}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 pl-1 pr-2 py-1 bg-white shadow-sm"
                    >
                      <span
                        className="h-5 w-5 rounded-full border border-slate-200 shrink-0"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                      <span className="text-xs text-slate-700 font-mono">{hex}</span>
                      <button
                        type="button"
                        onClick={() => setColors((prev: string[]) => prev.filter((c: string) => c !== hex))}
                        disabled={colors.length <= 1}
                        className="text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                        aria-label="Remove color"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {formError && formError.includes("color") && (
                <p className="text-xs text-red-600">{formError}</p>
              )}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                  placeholder="Add hex (e.g. #382828)"
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

            {/* Style */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Style</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pattern</label>
                  <select
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">Layer role</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                    value={layerRole}
                    onChange={(e) => setLayerRole(e.target.value)}
                  >
                    <option value="">None / Not applicable</option>
                    <option value="base">Base layer (e.g. tee, shirt)</option>
                    <option value="mid">Mid layer (e.g. sweater)</option>
                    <option value="outer">Outer layer (e.g. jacket, coat)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Fit</label>
                <select
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

            {!isEdit && (
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Photo</h3>
                {addStep === "form" && pendingAddFile && (
                  <p className="text-sm text-slate-600">Photo will be saved with this item.</p>
                )}
                {(!addStep || addStep !== "form" || !pendingAddFile) && (
                  <div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                      onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
                    />
                    {imageError && <p className="mt-1 text-xs text-red-600">{imageError}</p>}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="p-5 pt-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl shrink-0">
            {formError && (
              <p className="text-sm text-red-600 mb-3">{formError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
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
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}

async function uploadWardrobeItemImage(params: {
  firebaseUser: FirebaseUser;
  wardrobeItemId: string;
  file: File;
}) {
  const token = await params.firebaseUser.getIdToken();

  const fd = new FormData();
  fd.append("file", params.file);

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

  async function handleClearWardrobe() {
    if (!firebaseUser) return;

    const confirmed = window.confirm(
      "Delete ALL wardrobe items? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      setError(null);
      setLoading(true);

      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/wardrobe/clear", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to delete all items.");
        return;
      }

      // Keep UI consistent with DB: clear local state after successful API delete
      setItems([]);
    } catch (e) {
      console.error("Error clearing wardrobe:", e);
      setError("Failed to delete all items.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddItem(
    newItem: Omit<WardrobeItem, "id">,
  ): Promise<WardrobeItem | null> {
    if (!firebaseUser) {
      setError("You are not signed in. Please sign in again.");
      return null;
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
        setError(data.error ?? "Failed to save item.");
        return null;
      }

      const raw = data.item;
      const saved: WardrobeItem = { ...raw, id: raw.id ?? raw._id };

      if (!saved.id) {
        setError("Item saved but server did not return an id.");
        return null;
      }

      setItems((prev) => [saved, ...prev]);
      return saved;
    } catch (e) {
      console.error("Error saving wardrobe item:", e);
      setError("Failed to save item.");
      return null;
    }
  }

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
              cvAbortRef.current?.abort();
              cvAbortRef.current = null;
              setIsModalOpen(true);
              // Probe CV service in the background — if unavailable, surface the
              // fallback message immediately so users don't have to wait 15s.
              fetch("/api/cv/status")
                .then((r) => r.json())
                .then((data: { available?: boolean }) => {
                  if (!data.available) {
                    setCvError(
                      "Image analysis is temporarily unavailable. You can continue by filling the form manually."
                    );
                  }
                })
                .catch(() => {/* silently ignore — user can still try Analyze */});
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
        // Pipeline: type filter → name search → sort → render
        // None of these touch backend state or recommendation APIs.
        let display = activeFilter === "all"
          ? items
          : items.filter((it) => it.category === activeFilter);

        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          display = display.filter((it) => it.name.toLowerCase().includes(q));
        }

        display = [...display].sort((a, b) => {
          if (sortOrder === "name") {
            return a.name.localeCompare(b.name);
          }
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return sortOrder === "newest" ? tb - ta : ta - tb;
        });

        if (loading) {
          return <p className="text-sm text-slate-500">Loading wardrobe…</p>;
        }
        if (items.length === 0) {
          return (
            <p className="text-sm text-slate-500">
              You don&apos;t have any items yet. Start by adding a few key pieces
              you wear often (jeans, t‑shirts, jackets, shoes).
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
                return;
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
                  setError(respData.error ?? "Failed to update item.");
                  return;
                }
                const raw = respData.item;
                let updated: WardrobeItem = {
                  ...raw,
                  id: raw.id ?? raw._id,
                  // Preserve createdAt from existing state if PATCH response omits it
                  createdAt: raw.createdAt ?? editingItem.createdAt,
                };
                if (!updated.id) {
                  setError("Update succeeded but server did not return an id.");
                  return;
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
                    setError(e instanceof Error ? e.message : "Failed to upload image.");
                  }
                }
                setItems((prev) =>
                  prev.map((it) => (it.id === updated.id ? updated : it))
                );
              } catch (e) {
                console.error("Error updating wardrobe item:", e);
                setError("Failed to update item.");
              } finally {
                setEditingItem(null);
              }
            } else {
              const saved = await handleAddItem(data);
              if (saved && firebaseUser) {
                try {
                  if (addInferredCroppedImage) {
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
                  setError(e instanceof Error ? e.message : "Failed to upload image.");
                }
              }
              setAddStep(null);
              setAddInferred(null);
              setAddPendingFile(null);
              setAddInferredCroppedImage(null);
            }
          }}
          initialItem={
            editingItem
              ? {
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
                }
              : addStep === "form"
                ? addInferred ?? undefined
                : undefined
          }
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
              const res = await fetch("/api/cv/infer", {
                method: "POST",
                body: fd,
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
              const cropped = typeof (full as any).cropped_image_base64 === "string" ? (full as any).cropped_image_base64 : null;
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
