import { DAY_MS } from "./constants";

export function parseUtcTimestamp(value: number | string): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Providers sometimes return seconds and sometimes milliseconds.
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== "") {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toUtcDatePath(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function startOfUtcDay(timestampMs: number): number {
  return Math.floor(timestampMs / DAY_MS) * DAY_MS;
}

export function addUtcDays(timestampMs: number, days: number): number {
  return timestampMs + days * DAY_MS;
}
