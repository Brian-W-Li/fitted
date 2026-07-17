/**
 * The display-only wardrobe filter → search → sort pipeline (wardrobe/page.tsx).
 *
 * Extracted from the page's inline render so it is an importable, testable unit — a test that
 * reimplements this logic can never catch a regression in the page (the fake-mirror trap). This is
 * pure and touches NO backend/recommendation state: it derives a new `display` array for rendering
 * and never mutates its input.
 *
 * Pipeline order: type filter (by `category`) → case-insensitive name substring search → sort.
 * Sort: "name" → localeCompare A–Z; "newest"/"oldest" → by `createdAt` (missing `createdAt` sorts
 * to the end for "newest", to the front for "oldest", via the epoch-0 fallback).
 */
export type WardrobeFilterValue = "all" | "top" | "bottom" | "one piece" | "footwear";
export type WardrobeSortOrder = "newest" | "oldest" | "name";

/** The minimal slice of a wardrobe item the pipeline reads; the generic preserves the caller's type. */
export interface DisplayWardrobeItem {
  name: string;
  category: string;
  createdAt?: string;
}

export function applyWardrobePipeline<T extends DisplayWardrobeItem>(
  items: T[],
  filter: WardrobeFilterValue,
  searchQuery: string,
  sortOrder: WardrobeSortOrder,
): T[] {
  let display = filter === "all" ? items : items.filter((it) => it.category === filter);

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    display = display.filter((it) => it.name.toLowerCase().includes(q));
  }

  display = [...display].sort((a, b) => {
    if (sortOrder === "name") return a.name.localeCompare(b.name);
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sortOrder === "newest" ? tb - ta : ta - tb;
  });

  return display;
}
