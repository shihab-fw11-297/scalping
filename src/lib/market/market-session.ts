import { DAY_MS, MINUTE_MS } from "./constants";

export type WeekendSchedule =
  | {
      mode: "NEW_YORK_17";
      /** XAUUSD is closed for its daily 17:00-18:00 New York maintenance. */
      dailyMaintenance?: "NEW_YORK_17_TO_18";
    }
  | {
      mode: "FIXED_UTC";
      fridayCloseUtcHour: number;
      sundayOpenUtcHour: number;
    };

export type DailyBoundaryMode = "UTC_MIDNIGHT" | "NEW_YORK_17";

const NEW_YORK_TIME_ZONE = "America/New_York";

const nyPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface ZonedParts {
  weekday: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readNumericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`Missing ${type} while reading time-zone parts.`);
  return Number(value);
}

function getTimeZoneOffsetMs(timestampMs: number, timeZone: string): number {
  const formatter = timeZone === NEW_YORK_TIME_ZONE
    ? nyPartsFormatter
    : new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const asIfUtc = Date.UTC(
    readNumericPart(parts, "year"),
    readNumericPart(parts, "month") - 1,
    readNumericPart(parts, "day"),
    readNumericPart(parts, "hour"),
    readNumericPart(parts, "minute"),
    readNumericPart(parts, "second"),
  );
  return asIfUtc - Math.floor(timestampMs / 1000) * 1000;
}

const nyOffsetByUtcHour = new Map<number, number>();
const nyDailyBucketByUtcHour = new Map<number, number>();

function getNewYorkOffsetMs(timestampMs: number): number {
  const hourKey = Math.floor(timestampMs / 3_600_000);
  const cached = nyOffsetByUtcHour.get(hourKey);
  if (cached !== undefined) return cached;
  const offset = getTimeZoneOffsetMs(hourKey * 3_600_000, NEW_YORK_TIME_ZONE);
  nyOffsetByUtcHour.set(hourKey, offset);
  return offset;
}

function getNewYorkParts(timestampMs: number): ZonedParts {
  const shifted = new Date(timestampMs + getNewYorkOffsetMs(timestampMs));
  return {
    weekday: shifted.getUTCDay(),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Converts an unambiguous local wall-clock time to UTC. */
function zonedDateTimeToUtc(parts: ZonedParts, timeZone: string): number {
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Two passes handle offset changes around DST boundaries.
  let candidate = wallClockUtc - getTimeZoneOffsetMs(wallClockUtc, timeZone);
  candidate = wallClockUtc - getTimeZoneOffsetMs(candidate, timeZone);
  return candidate;
}

function addLocalCalendarDays(parts: ZonedParts, days: number): ZonedParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    weekday: shifted.getUTCDay(),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function isExpectedForexClosure(
  timestampMs: number,
  schedule: WeekendSchedule,
): boolean {
  if (schedule.mode === "FIXED_UTC") {
    const date = new Date(timestampMs);
    const day = date.getUTCDay();
    const hour = date.getUTCHours();
    if (day === 6) return true;
    if (day === 5 && hour >= schedule.fridayCloseUtcHour) return true;
    if (day === 0 && hour < schedule.sundayOpenUtcHour) return true;
    return false;
  }

  const parts = getNewYorkParts(timestampMs);
  const minutesSinceMidnight = parts.hour * 60 + parts.minute;
  const closeMinute = 17 * 60;
  const maintenanceEndMinute = 18 * 60;

  if (parts.weekday === 6) return true;
  if (parts.weekday === 5 && minutesSinceMidnight >= closeMinute) return true;
  if (parts.weekday === 0 && minutesSinceMidnight < closeMinute) return true;
  if (
    schedule.dailyMaintenance === "NEW_YORK_17_TO_18" &&
    parts.weekday !== 5 &&
    minutesSinceMidnight >= closeMinute &&
    minutesSinceMidnight < maintenanceEndMinute
  ) {
    return true;
  }
  return false;
}

export function countExpectedMarketMinutes(
  fromTimestampMs: number,
  toTimestampMs: number,
  schedule: WeekendSchedule,
): { tradable: number; closed: number } {
  let tradable = 0;
  let closed = 0;
  for (
    let timestamp = ceilToMinute(fromTimestampMs);
    timestamp < toTimestampMs;
    timestamp += MINUTE_MS
  ) {
    if (isExpectedForexClosure(timestamp, schedule)) closed += 1;
    else tradable += 1;
  }
  return { tradable, closed };
}

export function getDailyBucketStart(
  timestampMs: number,
  mode: DailyBoundaryMode,
): number {
  if (mode === "UTC_MIDNIGHT") return Math.floor(timestampMs / DAY_MS) * DAY_MS;

  const hourKey = Math.floor(timestampMs / 3_600_000);
  const cached = nyDailyBucketByUtcHour.get(hourKey);
  if (cached !== undefined) return cached;

  const local = getNewYorkParts(timestampMs);
  const afterBoundary = local.hour >= 17;
  const boundaryDate = afterBoundary ? local : addLocalCalendarDays(local, -1);
  const bucketStart = zonedDateTimeToUtc(
    {
      ...boundaryDate,
      hour: 17,
      minute: 0,
      second: 0,
    },
    NEW_YORK_TIME_ZONE,
  );
  nyDailyBucketByUtcHour.set(hourKey, bucketStart);
  return bucketStart;
}

export function getNextDailyBucketStart(
  bucketStartMs: number,
  mode: DailyBoundaryMode,
): number {
  if (mode === "UTC_MIDNIGHT") return bucketStartMs + DAY_MS;

  const local = getNewYorkParts(bucketStartMs + MINUTE_MS);
  const nextDate = addLocalCalendarDays(local, 1);
  return zonedDateTimeToUtc(
    {
      ...nextDate,
      hour: 17,
      minute: 0,
      second: 0,
    },
    NEW_YORK_TIME_ZONE,
  );
}

export function describeDailyBoundary(mode: DailyBoundaryMode): string {
  return mode === "UTC_MIDNIGHT"
    ? "Derived D1 candles start at 00:00 UTC."
    : "Derived D1 candles use the 17:00 America/New_York trading-day boundary, including DST changes.";
}

export function ceilToMinute(timestampMs: number): number {
  return Math.ceil(timestampMs / MINUTE_MS) * MINUTE_MS;
}
