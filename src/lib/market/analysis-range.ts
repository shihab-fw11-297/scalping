import type { CompactCandle, Timeframe, TimeframeDataset, VisibleDatasetRange } from "./types";

function lowerBound(candles: readonly CompactCandle[], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function visibleRangeForDataset(
  dataset: TimeframeDataset,
  fromTimestampMs: number,
  toTimestampMs: number,
): VisibleDatasetRange {
  const start = lowerBound(dataset.candles, fromTimestampMs);
  const end = lowerBound(dataset.candles, toTimestampMs);
  return { start, end, total: Math.max(0, end - start) };
}

export function createVisibleRanges(
  datasets: Record<Timeframe, TimeframeDataset>,
  fromTimestampMs: number,
  toTimestampMs: number,
): Record<Timeframe, VisibleDatasetRange> {
  return {
    M1: visibleRangeForDataset(datasets.M1, fromTimestampMs, toTimestampMs),
    M5: visibleRangeForDataset(datasets.M5, fromTimestampMs, toTimestampMs),
    M15: visibleRangeForDataset(datasets.M15, fromTimestampMs, toTimestampMs),
    H1: visibleRangeForDataset(datasets.H1, fromTimestampMs, toTimestampMs),
    D1: visibleRangeForDataset(datasets.D1, fromTimestampMs, toTimestampMs),
  };
}

export function sliceVisibleDataset(
  dataset: TimeframeDataset,
  range: VisibleDatasetRange,
): TimeframeDataset {
  return {
    candles: dataset.candles.slice(range.start, range.end),
    completeness: dataset.completeness.slice(range.start, range.end),
  };
}
