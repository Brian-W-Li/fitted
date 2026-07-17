export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// Storage bounds (§I): the render adapter clamps what reaches the WIRE
// (lib/mlRequestAdapter MAX_ITEM_NAME_CHARS / MAX_ITEM_TAGS / MAX_ITEM_TAG_CHARS), but nothing
// bounded what Mongo STORES — an authenticated caller could persist ~4.5MB strings per request
// against the shared 512MB Atlas M0. Caps align with the wire clamps where a wire clamp exists;
// `notes` never reaches the wire and gets its own cap. Rejection (not truncation) — a cap hit is
// user-visible and fixable, and silent truncation would store data the user never entered.
export const MAX_NAME_CHARS = 200;
export const MAX_FIELD_CHARS = 60;
export const MAX_NOTES_CHARS = 2000;
export const MAX_IMAGE_PATH_CHARS = 2048;
export const MAX_ARRAY_ITEMS = 25;

const FIELD_MAX_CHARS: Record<string, number> = {
  name: MAX_NAME_CHARS,
  category: MAX_FIELD_CHARS,
  subCategory: MAX_FIELD_CHARS,
  pattern: MAX_FIELD_CHARS,
  fit: MAX_FIELD_CHARS,
  size: MAX_FIELD_CHARS,
  layerRole: MAX_FIELD_CHARS,
  notes: MAX_NOTES_CHARS,
  imagePath: MAX_IMAGE_PATH_CHARS,
  clothingType: MAX_FIELD_CHARS,
};

// Reject ill-formed UTF-16 (a lone surrogate half) at the storage door. A stored lone surrogate
// is a permanent render-sinker: it passes the adapter projection, then the service rejects the
// WHOLE render pre-spend (`_require_utf8`, §F reject-not-coerce) on every request until the item
// is edited. Error messages name the field only — never echo the value.
function checkStringBounds(value: string, field: string): string | null {
  const max = FIELD_MAX_CHARS[field];
  if (max !== undefined && value.length > max) {
    return `${field} must be at most ${max} characters`;
  }
  if (!value.isWellFormed()) {
    return `${field} contains invalid characters`;
  }
  return null;
}

export type WardrobeCreatePayload = {
  name: string;
  clothingType?: string;
  warmth?: number;
  category: string;
  subCategory: string;
  pattern: string;
  colors: string[];
  fit: string;
  size: string;
  seasons: string[];
  occasions: string[];
  notes: string;
  isAvailable: boolean;
  layerRole: string;
};

export type WardrobePatchPayload = {
  update: Record<string, unknown>;
  suppliedWarmth?: number;
  hasSuppliedWarmth: boolean;
  warmthDrivingFieldsChanged: boolean;
};

const STRING_FIELDS = [
  "subCategory",
  "pattern",
  "fit",
  "size",
  "notes",
  "layerRole",
] as const;

const PATCH_STRING_FIELDS = [...STRING_FIELDS, "imagePath"] as const;
const ARRAY_FIELDS = ["colors", "seasons", "occasions"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  label: string,
): ValidationResult<string> {
  const value = body[field];
  if (typeof value !== "string") {
    return { ok: false, error: `${label} is required` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${label} is required` };
  }

  const boundsError = checkStringBounds(trimmed, field);
  if (boundsError) {
    return { ok: false, error: boundsError };
  }

  return { ok: true, value: trimmed };
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string | undefined> {
  if (!(field in body) || body[field] === undefined) {
    return { ok: true, value: undefined };
  }

  const value = body[field];
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }

  const trimmed = value.trim();
  const boundsError = checkStringBounds(trimmed, field);
  if (boundsError) {
    return { ok: false, error: boundsError };
  }

  return { ok: true, value: trimmed };
}

function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string[] | undefined> {
  if (!(field in body) || body[field] === undefined) {
    return { ok: true, value: undefined };
  }

  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { ok: false, error: `${field} must be an array of strings` };
  }

  if (value.length > MAX_ARRAY_ITEMS) {
    return { ok: false, error: `${field} must have at most ${MAX_ARRAY_ITEMS} entries` };
  }
  for (const item of value as string[]) {
    if (item.length > MAX_FIELD_CHARS) {
      return { ok: false, error: `${field} entries must be at most ${MAX_FIELD_CHARS} characters` };
    }
    if (!item.isWellFormed()) {
      return { ok: false, error: `${field} contains invalid characters` };
    }
  }

  return { ok: true, value };
}

function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
  defaultValue?: boolean,
): ValidationResult<boolean | undefined> {
  if (!(field in body) || body[field] === undefined) {
    return { ok: true, value: defaultValue };
  }

  const value = body[field];
  if (typeof value !== "boolean") {
    return { ok: false, error: `${field} must be a boolean` };
  }

  return { ok: true, value };
}

function optionalNumber(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<number | undefined> {
  if (!(field in body) || body[field] === undefined) {
    return { ok: true, value: undefined };
  }

  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${field} must be a finite number` };
  }

  return { ok: true, value };
}

function optionalClothingType(body: Record<string, unknown>): ValidationResult<string | undefined> {
  if (!("clothingType" in body) || body.clothingType === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof body.clothingType !== "string") {
    return { ok: false, error: "clothingType must be a string" };
  }

  return { ok: true, value: body.clothingType };
}

export function validateWardrobeCreatePayload(
  body: unknown,
): ValidationResult<WardrobeCreatePayload> {
  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const name = requiredString(body, "name", "name");
  if (!name.ok) return name;

  const category = requiredString(body, "category", "category");
  if (!category.ok) return category;

  const clothingType = optionalClothingType(body);
  if (!clothingType.ok) return clothingType;

  const warmth = optionalNumber(body, "warmth");
  if (!warmth.ok) return warmth;

  const strings: Record<(typeof STRING_FIELDS)[number], string> = {
    subCategory: "",
    pattern: "",
    fit: "",
    size: "",
    notes: "",
    layerRole: "",
  };
  for (const field of STRING_FIELDS) {
    const parsed = optionalString(body, field);
    if (!parsed.ok) return parsed;
    strings[field] = parsed.value ?? "";
  }

  const arrays: Record<(typeof ARRAY_FIELDS)[number], string[]> = {
    colors: [],
    seasons: [],
    occasions: [],
  };
  for (const field of ARRAY_FIELDS) {
    const parsed = optionalStringArray(body, field);
    if (!parsed.ok) return parsed;
    arrays[field] = parsed.value ?? [];
  }

  const isAvailable = optionalBoolean(body, "isAvailable", true);
  if (!isAvailable.ok) return isAvailable;

  return {
    ok: true,
    value: {
      name: name.value,
      clothingType: clothingType.value,
      warmth: warmth.value,
      category: category.value,
      subCategory: strings.subCategory,
      pattern: strings.pattern,
      colors: arrays.colors,
      fit: strings.fit,
      size: strings.size,
      seasons: arrays.seasons,
      occasions: arrays.occasions,
      notes: strings.notes,
      isAvailable: isAvailable.value ?? true,
      layerRole: strings.layerRole,
    },
  };
}

export function validateWardrobePatchPayload(
  body: unknown,
): ValidationResult<WardrobePatchPayload> {
  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const update: Record<string, unknown> = {};

  for (const field of ["name", "category"] as const) {
    if (field in body) {
      const parsed = requiredString(body, field, field);
      if (!parsed.ok) return parsed;
      update[field] = parsed.value;
    }
  }

  const clothingType = optionalClothingType(body);
  if (!clothingType.ok) return clothingType;
  if (clothingType.value !== undefined) {
    update.clothingType = clothingType.value;
  }

  for (const field of PATCH_STRING_FIELDS) {
    const parsed = optionalString(body, field);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) {
      update[field] = parsed.value;
    }
  }

  for (const field of ARRAY_FIELDS) {
    const parsed = optionalStringArray(body, field);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) {
      update[field] = parsed.value;
    }
  }

  const isAvailable = optionalBoolean(body, "isAvailable");
  if (!isAvailable.ok) return isAvailable;
  if (isAvailable.value !== undefined) {
    update.isAvailable = isAvailable.value;
  }

  const suppliedWarmth = optionalNumber(body, "warmth");
  if (!suppliedWarmth.ok) return suppliedWarmth;

  return {
    ok: true,
    value: {
      update,
      suppliedWarmth: suppliedWarmth.value,
      hasSuppliedWarmth: suppliedWarmth.value !== undefined,
      warmthDrivingFieldsChanged: ["name", "category", "subCategory", "seasons"].some(
        (field) => field in body,
      ),
    },
  };
}
