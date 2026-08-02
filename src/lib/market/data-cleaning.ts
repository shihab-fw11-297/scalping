import type { CandleCompleteness, CompactCandle, DataIssue, GapRecord } from "./types";
import { isExpectedForexClosure, type WeekendSchedule } from "./market-session";

export interface CleanMarketDataResult {
  candles: CompactCandle[];
  closedMarketCandlesRemoved: number;
  staleCandlesRemoved: number;
  issues: DataIssue[];
}

function candleRange(candle: CompactCandle): number {
  return Math.max(0, candle[2] - candle[3]);
}

function sameQuote(left: CompactCandle, right: CompactCandle): boolean {
  return left[1] === right[1] && left[2] === right[2] && left[3] === right[3] && left[4] === right[4];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const copy = [...values].sort((a, b) => a - b);
  const middle = Math.floor(copy.length / 2);
  return copy.length % 2 === 0 ? (copy[middle - 1] + copy[middle]) / 2 : copy[middle];
}

/**
 * Removes provider candles that should not exist during the configured FX closure.
 * It also removes only highly conservative stale runs: at least three consecutive
 * identical OHLC candles whose range is effectively zero versus the recent median.
 */
export function cleanMarketCandles(
  candles: readonly CompactCandle[],
  schedule: WeekendSchedule,
): CleanMarketDataResult {
  const closureFiltered: CompactCandle[] = [];
  const issues: DataIssue[] = [];
  let closedMarketCandlesRemoved = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (isExpectedForexClosure(candle[0], schedule)) {
      closedMarketCandlesRemoved += 1;
      if (issues.length < 100) {
        issues.push({
          type: "EXPECTED_CLOSURE_CANDLE",
          index,
          message: `Removed provider candle at ${new Date(candle[0]).toISOString()} because the configured FX market was closed.`,
        });
      }
      continue;
    }
    closureFiltered.push(candle);
  }

  const keep = new Uint8Array(closureFiltered.length);
  keep.fill(1);
  let staleCandlesRemoved = 0;
  let runStart = 0;

  while (runStart < closureFiltered.length) {
    let runEnd = runStart + 1;
    while (runEnd < closureFiltered.length && sameQuote(closureFiltered[runStart], closureFiltered[runEnd])) {
      runEnd += 1;
    }

    const runLength = runEnd - runStart;
    if (runLength >= 3) {
      const priorRanges: number[] = [];
      for (let index = Math.max(0, runStart - 20); index < runStart; index += 1) {
        const range = candleRange(closureFiltered[index]);
        if (range > 0) priorRanges.push(range);
      }
      const recentMedian = median(priorRanges);
      const tinyThreshold = Math.max(0.0001, recentMedian * 0.001);
      const runRange = candleRange(closureFiltered[runStart]);
      if (runRange <= tinyThreshold) {
        // Keep the first quote as the last known observation and remove later stale repeats.
        for (let index = runStart + 1; index < runEnd; index += 1) {
          keep[index] = 0;
          staleCandlesRemoved += 1;
        }
        if (issues.length < 100) {
          issues.push({
            type: "STALE_PROVIDER_CANDLE",
            index: runStart,
            message: `Removed ${runLength - 1} repeated near-flat provider candles beginning ${new Date(closureFiltered[runStart][0]).toISOString()}.`,
          });
        }
      }
    }
    runStart = runEnd;
  }

  return {
    candles: closureFiltered.filter((_, index) => keep[index] === 1),
    closedMarketCandlesRemoved,
    staleCandlesRemoved,
    issues,
  };
}

/**
 * M1 candles immediately after a real tradable-data gap are marked incomplete.
 * This prevents setup/entry engines from treating a discontinuity as a clean break.
 */
export function createM1CompletenessWithGapSafety(
  candles: readonly CompactCandle[],
  gaps: readonly GapRecord[],
  safetyBars = 3,
): { completeness: CandleCompleteness[]; markedSafetyCandles: number } {
  const completeness: CandleCompleteness[] = Array.from({ length: candles.length }, () => ({
    actualChildren: 1,
    expectedChildren: 1,
    fullIntervalChildren: 1,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE" as const,
  }));

  let markedSafetyCandles = 0;
  for (const gap of gaps) {
    if (gap.missingTradableCandles <= 0) continue;
    let low = 0;
    let high = candles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candles[middle][0] < gap.toTimestampMs) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < Math.min(candles.length, low + safetyBars); index += 1) {
      if (completeness[index].status === "COMPLETE") markedSafetyCandles += 1;
      completeness[index] = {
        actualChildren: 0,
        expectedChildren: 1,
        fullIntervalChildren: 1,
        expectedClosedChildren: 0,
        completenessPercent: 0,
        status: "MISSING_DATA",
      };
    }
  }

  return { completeness, markedSafetyCandles };
}
