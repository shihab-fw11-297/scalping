import { DAY_MS, MINUTE_MS } from "./constants";
import { startOfUtcDay, toUtcDatePath } from "./time";

export interface FinageDateChunk {
  fromDate: string;
  toDate: string;
}

function parseUtcDatePath(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid UTC date path: ${value}`);
  }
  return timestamp;
}

export function countFinageChunkCalendarDays(chunk: FinageDateChunk): number {
  const from = parseUtcDatePath(chunk.fromDate);
  const to = parseUtcDatePath(chunk.toDate);
  if (to < from) throw new Error("Finage chunk end date is before its start date.");
  return Math.floor((to - from) / DAY_MS) + 1;
}

/** Splits one inclusive date chunk into two non-overlapping inclusive chunks. */
export function splitFinageDateChunk(
  chunk: FinageDateChunk,
): readonly [FinageDateChunk, FinageDateChunk] | null {
  const totalDays = countFinageChunkCalendarDays(chunk);
  if (totalDays <= 1) return null;

  const from = parseUtcDatePath(chunk.fromDate);
  const leftDays = Math.ceil(totalDays / 2);
  const leftEnd = from + (leftDays - 1) * DAY_MS;
  const rightStart = leftEnd + DAY_MS;

  return [
    { fromDate: chunk.fromDate, toDate: toUtcDatePath(leftEnd) },
    { fromDate: toUtcDatePath(rightStart), toDate: chunk.toDate },
  ] as const;
}

/**
 * Plans small, non-overlapping date chunks for Finage M1 requests.
 *
 * The provider's result limit is still respected, but an additional fixed
 * calendar-day cap prevents large 25-35 day M1 requests that can return 502.
 */
export function planFinageDateChunks(params: {
  fromTimestampMs: number;
  toTimestampMs: number;
  multiplierMinutes: number;
  targetMaxResults: number;
  maximumCalendarDaysPerChunk?: number;
}): FinageDateChunk[] {
  const {
    fromTimestampMs,
    toTimestampMs,
    multiplierMinutes,
    targetMaxResults,
    maximumCalendarDaysPerChunk,
  } = params;

  if (toTimestampMs <= fromTimestampMs) {
    throw new Error("The end time must be later than the start time.");
  }
  if (multiplierMinutes <= 0 || targetMaxResults <= 0) {
    throw new Error("Invalid chunk planner configuration.");
  }
  if (
    maximumCalendarDaysPerChunk !== undefined &&
    (!Number.isInteger(maximumCalendarDaysPerChunk) || maximumCalendarDaysPerChunk < 1)
  ) {
    throw new Error("maximumCalendarDaysPerChunk must be a positive integer.");
  }

  const barsPerCalendarDay = Math.ceil(DAY_MS / (multiplierMinutes * MINUTE_MS));
  const resultLimitedDays = Math.max(
    1,
    Math.floor(targetMaxResults / barsPerCalendarDay),
  );
  const daysPerChunk = Math.max(
    1,
    Math.min(resultLimitedDays, maximumCalendarDaysPerChunk ?? resultLimitedDays),
  );

  const chunks: FinageDateChunk[] = [];
  let cursor = startOfUtcDay(fromTimestampMs);
  const finalDay = startOfUtcDay(toTimestampMs - 1);

  while (cursor <= finalDay) {
    const end = Math.min(finalDay, cursor + (daysPerChunk - 1) * DAY_MS);
    chunks.push({
      fromDate: toUtcDatePath(cursor),
      toDate: toUtcDatePath(end),
    });
    cursor = end + DAY_MS;
  }

  return chunks;
}
