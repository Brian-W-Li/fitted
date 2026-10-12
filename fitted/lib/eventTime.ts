export type EventTimeBucket = "now" | "later_today" | "tomorrow" | "custom";

export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getEventTimeISO(bucket: EventTimeBucket, customValue: string, now = new Date()): string | undefined {
  if (bucket === "now") return undefined;
  if (bucket === "custom") {
    const parsed = new Date(customValue);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const date = new Date(now);
  if (bucket === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
  } else if (date.getHours() < 18) {
    date.setHours(18, 0, 0, 0);
  } else {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    date.setTime(Math.min(now.getTime() + 2 * 60 * 60 * 1000, endOfDay.getTime()));
  }
  return date.toISOString();
}
