export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

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

  return { ok: true, value: value.trim() };
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
