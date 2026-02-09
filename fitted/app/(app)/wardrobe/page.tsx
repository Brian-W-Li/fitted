/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";

type WardrobeItem = {
  id: string;
  name: string;
  category: string;
  colors: string[];
  fit: string;
  size: string;
  formality: string;
  seasons: string[];
  occasions: string[];
  notes?: string;
  imagePath?: string;
};

const FORMALITY_OPTIONS = [
  "Casual",
  "Smart Casual",
  "Business Casual",
  "Formal",
];

const SEASON_OPTIONS = ["Spring", "Summer", "Fall", "Winter"];

const OCCASION_OPTIONS = [
  "Everyday",
  "Work",
  "Going Out",
  "Formal Event",
  "Workout",
];

function imageUrlFromPath(imagePath?: string) {
  if (!imagePath) return null;

  // your backend returns "mongo:<imageId>"
  if (imagePath.startsWith("mongo:")) {
    const imageId = imagePath.slice("mongo:".length);
    return `/api/images/${imageId}`;
  }

  // if later you support other storage types, handle them here
  return null;
}

function WardrobeCard({
  item,
  onEdit,
  onDelete,
}: {
  item: WardrobeItem;
  onEdit: (item: WardrobeItem) => void;
  onDelete: (item: WardrobeItem) => void;
}) {
  const imgSrc = imageUrlFromPath(item.imagePath);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Image */}
      {imgSrc ? (
        <div className="relative h-44 w-full bg-slate-50">
          <img
            src={imgSrc}
            alt={item.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex h-44 w-full items-center justify-center bg-slate-50 text-xs text-slate-400">
          No photo
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{item.name}</h3>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {item.category}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="rounded-full border border-red-200 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {item.fit && `${item.fit} fit`}
          {item.size && ` • Size ${item.size}`}
          {item.formality && ` • ${item.formality}`}
        </p>

        {item.colors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.colors.map((c) => (
              <span
                key={c}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {(item.seasons.length > 0 || item.occasions.length > 0) && (
          <div className="mt-2 space-y-1">
            {item.seasons.length > 0 && (
              <p className="text-[11px] text-slate-500">
                <span className="font-semibold text-slate-600">Seasons:</span>{" "}
                {item.seasons.join(", ")}
              </p>
            )}
            {item.occasions.length > 0 && (
              <p className="text-[11px] text-slate-500">
                <span className="font-semibold text-slate-600">Occasions:</span>{" "}
                {item.occasions.join(", ")}
              </p>
            )}
          </div>
        )}

        {item.notes && (
          <p className="mt-2 line-clamp-2 text-[11px] italic text-slate-500">
            {item.notes}
          </p>
        )}
      </div>
    </div>
  );
}

type WardrobeFormValues = Omit<WardrobeItem, "id">;

type AddItemModalProps = {
  onClose: () => void;
  onSave: (item: WardrobeFormValues, imageFile: File | null) =>Promise<void> | void;
  initialItem?: WardrobeFormValues;
  title?: string;
};

function AddItemModal({ onClose, onSave, initialItem, title }: AddItemModalProps) {
  const [name, setName] = useState(initialItem?.name ?? "");
  const [category, setCategory] = useState(initialItem?.category ?? "");
  const [colorsInput, setColorsInput] = useState(
    initialItem?.colors?.join(", ") ?? "",
  );
  const [fit, setFit] = useState(initialItem?.fit ?? "");
  const [size, setSize] = useState(initialItem?.size ?? "");
  const [formality, setFormality] = useState(initialItem?.formality ?? "");
  const [seasons, setSeasons] = useState<string[]>(
    initialItem?.seasons ?? [],
  );
  const [occasions, setOccasions] = useState<string[]>(
    initialItem?.occasions ?? [],
  );
  const [notes, setNotes] = useState(initialItem?.notes ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

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

  function toggleInArray(value: string, current: string[], setter: (v: string[]) => void) {
    if (current.includes(value)) {
      setter(current.filter((v) => v !== value));
    } else {
      setter([...current, value]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !category.trim()) return;

    const colors = colorsInput
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    await onSave(
      {
        name: name.trim(),
        category: category.trim(),
        colors,
        fit: fit.trim(),
        size: size.trim(),
        formality: formality.trim(),
        seasons,
        occasions,
        notes: notes.trim() || undefined,
      },
      imageFile
    );

    onClose();
  }

  return (
    
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {title ?? "Add clothing item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Name *
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blue denim jacket"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Type / Category *
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Jacket, T‑shirt, Jeans"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Colors (comma separated)
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              value={colorsInput}
              onChange={(e) => setColorsInput(e.target.value)}
              placeholder="e.g. blue, black"
            />
          </div>

          <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Photo {initialItem?.imagePath ? "(current image saved)" : "(optional)"}
          </label>
          {/* Show existing image if editing */}
          {initialItem?.imagePath && !imageFile && (
            <div className="mt-2 mb-2 flex items-center gap-3">
              <div className="h-16 w-16 overflow-hidden rounded-lg bg-slate-100">
                <img
                  src={imageUrlFromPath(initialItem.imagePath) || ""}
                  alt="Current"
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="text-xs text-slate-500">
                Current image will be kept unless you upload a new one.
              </p>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
          />
          {imageError && <p className="mt-1 text-xs text-red-600">{imageError}</p>}
          {imageFile && (
            <p className="mt-1 text-xs text-slate-500">
              New image selected: {imageFile.name} ({Math.round(imageFile.size / 1024)} KB)
            </p>
          )}
        </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Fit
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                value={fit}
                onChange={(e) => setFit(e.target.value)}
                placeholder="e.g. Slim, Relaxed"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Size
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. M, 32x30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Formality
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                value={formality}
                onChange={(e) => setFormality(e.target.value)}
              >
                <option value="">Select…</option>
                {FORMALITY_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Seasons
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SEASON_OPTIONS.map((s) => {
                  const active = seasons.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleInArray(s, seasons, setSeasons)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        active
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Occasions
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {OCCASION_OPTIONS.map((o) => {
                  const active = occasions.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleInArray(o, occasions, setOccasions)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        active
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Notes
            </label>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any extra details you care about (e.g. good for cold days, goes well with black jeans)…"
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save item
            </button>
          </div>
        </form>
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
  const [error, setError] = useState<string | null>(null);

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
        const normalized = (data.items ?? []).map((it: any) => ({
          ...it,
          id: it.id ?? it._id,
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Wardrobe</h1>
          <p className="mt-1 text-sm text-slate-600">
            Add pieces from your closet so we can start building outfits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingItem(null);
            setIsModalOpen(true);
          }}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Add item
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading wardrobe…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">
          You don&apos;t have any items yet. Start by adding a few key pieces
          you wear often (jeans, t‑shirts, jackets, shoes).
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <WardrobeCard
              key={item.id}
              item={item}
              onEdit={(it) => {
                setEditingItem(it);
                setIsModalOpen(true);
              }}
              onDelete={handleDeleteItem}
            />
          ))}
        </div>
      )}

      {isModalOpen && (
        <AddItemModal
          onClose={() => setIsModalOpen(false)}
          onSave={async (data, imageFile) => {
            if (editingItem) {
              // Edit existing item
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

              // 🔑 NORMALIZE ID (THIS IS THE FIX)
              const raw = respData.item;
              let updated: WardrobeItem = {
                ...raw,
                id: raw.id ?? raw._id,
              };

              if (!updated.id) {
                setError("Update succeeded but server did not return an id.");
                return;
              }

              // 🖼️ upload image AFTER item exists
              if (imageFile && firebaseUser) {
                try {
                  const up = await uploadWardrobeItemImage({
                    firebaseUser,
                    wardrobeItemId: updated.id,
                    file: imageFile,
                  });
                  updated = { ...updated, imagePath: up.imagePath };
                } catch (e) {
                  console.error(e);
                  setError(
                    e instanceof Error ? e.message : "Failed to upload image."
                  );
                }
              }

              // 🔄 update UI state
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
              if (saved && imageFile && firebaseUser) {
                try {
                  const up = await uploadWardrobeItemImage({
                    firebaseUser,
                    wardrobeItemId: saved.id,
                    file: imageFile,
                  });
                  setItems((prev) => prev.map((it) => it.id === saved.id ? 
                    { ...it, imagePath: up.imagePath } : it));
                  
                } catch (e) {
                  console.error(e);
                  setError(e instanceof Error ? e.message : "Failed to upload image.");
                }
              }
            } 
          }}
          initialItem={
            editingItem
              ? {
                  name: editingItem.name,
                  category: editingItem.category,
                  colors: editingItem.colors,
                  fit: editingItem.fit,
                  size: editingItem.size,
                  formality: editingItem.formality,
                  seasons: editingItem.seasons,
                  occasions: editingItem.occasions,
                  notes: editingItem.notes,
                  imagePath: editingItem.imagePath,
                }
              : undefined
          }
          title={editingItem ? "Edit clothing item" : "Add clothing item"}
        />
      )}
    </div>
  );
}
