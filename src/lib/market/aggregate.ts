import {
  DERIVED_TIMEFRAMES,
  MINUTE_MS,
  TIMEFRAME_MS,
} from "./constants";
import {
  ceilToMinute,
  getDailyBucketStart,
  getNextDailyBucketStart,
  isExpectedForexClosure,
  type DailyBoundaryMode,
  type WeekendSchedule,
} from "./market-session";
import type {
  CandleCompleteness,
  CandleCoverageStatus,
  CompactCandle,
  DerivedTimeframe,
  RollingWindowSnapshot,
  TimeframeDataset,
} from "./types";

interface MutableBucket {
  bucketStart: number;
  bucketEnd: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  actualChildren: number;
  incompleteSourceChildren: number;
}

export interface AggregationOptions {
  requestFromMs: number;
  requestToMs: number;
  weekendSchedule: WeekendSchedule;
  dailyBoundaryMode: DailyBoundaryMode;
  m1Completeness?: readonly CandleCompleteness[];
}

interface MinuteCoverageIndex {
  alignedStartMs: number;
  minuteCount: number;
  closedPrefix: Uint32Array;
}

function createMinuteCoverageIndex(options: AggregationOptions): MinuteCoverageIndex {
  const alignedStartMs = ceilToMinute(options.requestFromMs);
  const minuteCount = Math.max(0, Math.ceil((options.requestToMs - alignedStartMs) / MINUTE_MS));
  const closedPrefix = new Uint32Array(minuteCount + 1);

  for (let index = 0; index < minuteCount; index += 1) {
    const timestamp = alignedStartMs + index * MINUTE_MS;
    closedPrefix[index + 1] =
      closedPrefix[index] + (isExpectedForexClosure(timestamp, options.weekendSchedule) ? 1 : 0);
  }

  return { alignedStartMs, minuteCount, closedPrefix };
}

function countExpectedMinutes(
  index: MinuteCoverageIndex,
  fromMs: number,
  toMs: number,
): { tradable: number; closed: number } {
  if (toMs <= fromMs || index.minuteCount === 0) return { tradable: 0, closed: 0 };

  const firstMinute = ceilToMinute(fromMs);
  const startIndex = Math.max(
    0,
    Math.min(index.minuteCount, Math.floor((firstMinute - index.alignedStartMs) / MINUTE_MS)),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(index.minuteCount, Math.ceil((toMs - index.alignedStartMs) / MINUTE_MS)),
  );
  const total = endIndex - startIndex;
  const closed = index.closedPrefix[endIndex] - index.closedPrefix[startIndex];
  return { tradable: total - closed, closed };
}

function bucketBounds(
  timestampMs: number,
  timeframe: DerivedTimeframe,
  dailyBoundaryMode: DailyBoundaryMode,
): { start: number; end: number } {
  if (timeframe === "D1") {
    const start = getDailyBucketStart(timestampMs, dailyBoundaryMode);
    return { start, end: getNextDailyBucketStart(start, dailyBoundaryMode) };
  }
  const interval = TIMEFRAME_MS[timeframe];
  const start = Math.floor(timestampMs / interval) * interval;
  return { start, end: start + interval };
}

function calculateCoverage(
  bucket: MutableBucket,
  options: AggregationOptions,
  minuteIndex: MinuteCoverageIndex,
): CandleCompleteness {
  const fullIntervalChildren = Math.max(
    1,
    Math.round((bucket.bucketEnd - bucket.bucketStart) / MINUTE_MS),
  );
  const effectiveStart = Math.max(bucket.bucketStart, options.requestFromMs);
  const effectiveEnd = Math.min(bucket.bucketEnd, options.requestToMs);
  const expected = countExpectedMinutes(minuteIndex, effectiveStart, effectiveEnd);
  const expectedChildren = expected.tradable;
  const expectedClosedChildren = expected.closed;

  const boundaryPartial =
    effectiveStart > bucket.bucketStart || effectiveEnd < bucket.bucketEnd;
  const hasClosure = expectedClosedChildren > 0;
  const effectiveActualChildren = Math.max(0, bucket.actualChildren - bucket.incompleteSourceChildren);
  const missing = effectiveActualChildren < expectedChildren;
  const overfull = bucket.actualChildren > expectedChildren;

  let status: CandleCoverageStatus;
  if (overfull) status = "OVERFULL";
  else if (missing && (boundaryPartial || hasClosure)) status = "PARTIAL_MISSING_DATA";
  else if (missing) status = "MISSING_DATA";
  else if (boundaryPartial && hasClosure) status = "BOUNDARY_AND_CLOSURE";
  else if (boundaryPartial) status = "PARTIAL_REQUEST_BOUNDARY";
  else if (hasClosure) status = "EXPECTED_MARKET_CLOSURE";
  else status = "COMPLETE";

  const completenessPercent = expectedChildren === 0
    ? effectiveActualChildren === 0 ? 100 : 0
    : Math.min(100, (effectiveActualChildren / expectedChildren) * 100);

  return {
    actualChildren: effectiveActualChildren,
    expectedChildren,
    fullIntervalChildren,
    expectedClosedChildren,
    completenessPercent,
    status,
  };
}

function finalizeBucket(
  bucket: MutableBucket,
  options: AggregationOptions,
  minuteIndex: MinuteCoverageIndex,
): { candle: CompactCandle; completeness: CandleCompleteness } {
  return {
    candle: [
      bucket.bucketStart,
      bucket.open,
      bucket.high,
      bucket.low,
      bucket.close,
      bucket.volume,
    ],
    completeness: calculateCoverage(bucket, options, minuteIndex),
  };
}

/**
 * Aggregates all fixed higher timeframes in one traversal of M1 data.
 * Four timeframes are constant, therefore overall complexity is O(n).
 */
export function aggregateAllTimeframes(
  m1Candles: readonly CompactCandle[],
  options: AggregationOptions,
): Record<DerivedTimeframe, TimeframeDataset> {
  const output: Record<DerivedTimeframe, TimeframeDataset> = {
    M5: { candles: [], completeness: [] },
    M15: { candles: [], completeness: [] },
    H1: { candles: [], completeness: [] },
    D1: { candles: [], completeness: [] },
  };

  const active = new Map<DerivedTimeframe, MutableBucket>();
  const minuteIndex = createMinuteCoverageIndex(options);

  for (let index = 0; index < m1Candles.length; index += 1) {
    const [timestamp, open, high, low, close, volume] = m1Candles[index];
    const sourceIncomplete = options.m1Completeness?.[index]?.status !== undefined &&
      !["COMPLETE", "EXPECTED_MARKET_CLOSURE", "PARTIAL_REQUEST_BOUNDARY", "BOUNDARY_AND_CLOSURE"].includes(options.m1Completeness[index].status);

    for (const timeframe of DERIVED_TIMEFRAMES) {
      const bounds = bucketBounds(timestamp, timeframe, options.dailyBoundaryMode);
      const current = active.get(timeframe);

      if (!current || current.bucketStart !== bounds.start) {
        if (current) {
          const finalized = finalizeBucket(current, options, minuteIndex);
          output[timeframe].candles.push(finalized.candle);
          output[timeframe].completeness.push(finalized.completeness);
        }
        active.set(timeframe, {
          bucketStart: bounds.start,
          bucketEnd: bounds.end,
          open,
          high,
          low,
          close,
          volume,
          actualChildren: 1,
          incompleteSourceChildren: sourceIncomplete ? 1 : 0,
        });
        continue;
      }

      if (high > current.high) current.high = high;
      if (low < current.low) current.low = low;
      current.close = close;
      current.volume += volume;
      current.actualChildren += 1;
      if (sourceIncomplete) current.incompleteSourceChildren += 1;
    }
  }

  for (const timeframe of DERIVED_TIMEFRAMES) {
    const current = active.get(timeframe);
    if (!current) continue;
    const finalized = finalizeBucket(current, options, minuteIndex);
    output[timeframe].candles.push(finalized.candle);
    output[timeframe].completeness.push(finalized.completeness);
  }

  return output;
}

/** Calculates only the latest rolling window and avoids materializing 100K windows. */
export function calculateLatestRollingWindow(
  candles: readonly CompactCandle[],
  windowMinutes: number,
): RollingWindowSnapshot | null {
  if (candles.length === 0 || windowMinutes <= 0) return null;

  const expectedCandles = windowMinutes;
  const last = candles[candles.length - 1];
  const toTimestampMs = last[0];
  const minimumTimestamp = toTimestampMs - (windowMinutes - 1) * MINUTE_MS;

  let startIndex = candles.length - 1;
  while (startIndex > 0 && candles[startIndex - 1][0] >= minimumTimestamp) {
    startIndex -= 1;
  }

  let high = -Infinity;
  let low = Infinity;
  let volume = 0;

  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle[2] > high) high = candle[2];
    if (candle[3] < low) low = candle[3];
    volume += candle[5];
  }

  const candlesPresent = candles.length - startIndex;
  return {
    windowMinutes,
    fromTimestampMs: candles[startIndex][0],
    toTimestampMs,
    open: candles[startIndex][1],
    high,
    low,
    close: last[4],
    volume,
    candlesPresent,
    expectedCandles,
    completenessPercent: Math.min(100, (candlesPresent / expectedCandles) * 100),
  };
}
