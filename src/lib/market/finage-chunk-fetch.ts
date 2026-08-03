import {
  fetchFinageM1AggregateResponse,
  type FetchFinageAggregatesParams,
} from "@/lib/finage/client";
import type { FinageRawAggregate } from "./types";
import {
  countFinageChunkCalendarDays,
  type FinageDateChunk,
} from "./chunk-plan";
import {
  fetchDateChunkAdaptive,
  type AdaptiveChunkFetchResult,
} from "./adaptive-chunk-fetch";
import { STATIC_RUNTIME_LIMITS } from "./static-limits";
import { DAY_MS } from "./constants";
import { toUtcDatePath } from "./time";

export type FinageAdaptiveFetchResult =
  AdaptiveChunkFetchResult<FinageRawAggregate>;

export interface FetchFinageChunkAdaptiveParams
  extends Omit<FetchFinageAggregatesParams, "fromDate" | "toDate"> {
  chunk: FinageDateChunk;
  minimumCalendarDays: number;
  maximumSplitDepth: number;
}

/**
 * Enforces the provider-call invariant independently of the upstream planner.
 * This prevents a future caller from merging more than one target day per chunk.
 */
function assertCalendarDayMaximum(chunk: FinageDateChunk): void {
  const calendarDays = countFinageChunkCalendarDays(chunk);
  if (calendarDays > STATIC_RUNTIME_LIMITS.FINAGE_M1_CHUNK_CALENDAR_DAYS) {
    throw new Error(
      `Finage M1 requests are hard-limited to ` +
        `${STATIC_RUNTIME_LIMITS.FINAGE_M1_CHUNK_CALENDAR_DAYS} calendar day; ` +
        `received ${chunk.fromDate}..${chunk.toDate} (${calendarDays} days).`,
    );
  }
}

function followingUtcDate(datePath: string): string {
  const timestamp = Date.parse(`${datePath}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid UTC date path: ${datePath}`);
  return toUtcDatePath(timestamp + DAY_MS);
}

/** Finage-specific wrapper around the generic adaptive date-chunk fetcher. */
export async function fetchFinageChunkAdaptive(
  params: FetchFinageChunkAdaptiveParams,
): Promise<FinageAdaptiveFetchResult> {
  const {
    chunk,
    minimumCalendarDays,
    maximumSplitDepth,
    ...request
  } = params;

  assertCalendarDayMaximum(chunk);

  return fetchDateChunkAdaptive({
    chunk,
    minimumCalendarDays,
    maximumSplitDepth,
    fetchChunk: async (currentChunk) => {
      // Every request path is checked so no caller can bypass the compiled
      // one-calendar-day provider boundary.
      assertCalendarDayMaximum(currentChunk);
      return fetchFinageM1AggregateResponse({
        ...request,
        fromDate: currentChunk.fromDate,
        // Finage can return only the midnight candle when FROM=TO. The
        // following-date overlap reliably returns the target day's full M1
        // stream. Pipeline normalization discards the overlap before merge.
        toDate: followingUtcDate(currentChunk.toDate),
      });
    },
  });
}
