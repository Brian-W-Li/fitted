import { ExperienceValidationError } from "./errors";

export const MAX_WEAR_TIMEZONE_LENGTH = 100;

export interface WearDate {
  occurredOn: string;
  timezone: string;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** `now` must come from the server; no client-clock or implicit UTC fallback. */
export function validateCalendarDay(occurredOn: unknown, timezone: unknown, now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError("Wear-date validation requires a valid server clock");
  }
  if (!isCalendarDate(occurredOn)) {
    throw new ExperienceValidationError("occurredOn", "Enter a valid date in YYYY-MM-DD format");
  }
  // Intl can also accept numeric offset identifiers on newer runtimes. This API requires a name.
  if (
    typeof timezone !== "string" ||
    timezone.length > MAX_WEAR_TIMEZONE_LENGTH ||
    !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(timezone)
  ) {
    throw new ExperienceValidationError("timezone", "Choose a valid named timezone");
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new ExperienceValidationError("timezone", "Choose a valid named timezone");
  }
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  const today = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
  return { date: occurredOn, timezone, today };
}

/** Wear is past fact; planning uses the same calendar/timezone validation with a separate bound. */
export function validateWearDate(occurredOn: unknown, timezone: unknown, now: Date): WearDate {
  const valid = validateCalendarDay(occurredOn, timezone, now);
  if (valid.date > valid.today) {
    throw new ExperienceValidationError("occurredOn", "A reported wear cannot be in the future");
  }
  return { occurredOn: valid.date, timezone: valid.timezone };
}
