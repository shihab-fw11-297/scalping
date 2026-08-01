import { DAY_MS, MINUTE_MS } from "./constants";
import { startOfUtcDay, toUtcDatePath } from "./time";

export interface FinageDateChunk {
  fromDate: string;
  toDate: string;
}

/**
 * Finage documents a maximum result limit of 50,000. We target a lower limit
 * (default 45,000) so production requests do not sit exactly on the boundary.
 *
 * Complexity: O(number of chunks), normally 1-4 for a 100K-candle analysis.
 */
export function planFinageDateChunks(params: {
  fromTimestampMs: number;
  toTimestampMs: number;
  multiplierMinutes: number;
  targetMaxResults: number;
}): FinageDateChunk[] {
  const {
    fromTimestampMs,
    toTimestampMs,
    multiplierMinutes,
    targetMaxResults,
  } = params;

  if (toTimestampMs <= fromTimestampMs) {
    throw new Error("The end time must be later than the start time.");
  }
  if (multiplierMinutes <= 0 || targetMaxResults <= 0) {
    throw new Error("Invalid chunk planner configuration.");
  }

  const barsPerCalendarDay = Math.ceil(DAY_MS / (multiplierMinutes * MINUTE_MS));
  const daysPerChunk = Math.max(1, Math.floor(targetMaxResults / barsPerCalendarDay));

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
