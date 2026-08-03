import type {
  CompactCandle,
  DataIssue,
  FinageRawAggregate,
} from "./types";
import { parseUtcTimestamp } from "./time";

export interface NormalizeResult {
  candles: CompactCandle[];
  issues: DataIssue[];
  outOfOrderDetected: boolean;
  filteredOutsideRange: number;
}

function isFinitePrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validates and normalizes provider data in one pass. Sorting is only invoked
 * when an out-of-order timestamp is actually detected.
 *
 * Typical complexity: O(n). Worst case with bad provider order: O(n log n).
 */
export function normalizeFinageAggregates(
  raw: readonly FinageRawAggregate[],
  exactFromMs: number,
  exactToMs: number,
): NormalizeResult {
  const candles: CompactCandle[] = [];
  const issues: DataIssue[] = [];
  let previousTimestamp = -Infinity;
  let outOfOrderDetected = false;
  let filteredOutsideRange = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const timestamp = parseUtcTimestamp(item.t);

    if (timestamp === null) {
      issues.push({
        type: "INVALID_TIMESTAMP",
        index,
        message: `Invalid timestamp: ${String(item.t)}`,
      });
      continue;
    }

    if (timestamp < exactFromMs || timestamp >= exactToMs) {
      // Date-based provider chunks intentionally include boundary-day candles.
      // Post-filtering is expected and is not treated as a provider error.
      filteredOutsideRange += 1;
      continue;
    }

    const { o, h, l, c } = item;
    const v = Number.isFinite(item.v) && (item.v ?? 0) >= 0 ? (item.v ?? 0) : 0;

    if (![o, h, l, c].every(isFinitePrice)) {
      issues.push({
        type: "INVALID_NUMBER",
        index,
        message: "OHLC contains a missing, non-finite, or non-positive number.",
      });
      continue;
    }

    if (h < Math.max(o, c) || l > Math.min(o, c) || h < l) {
      issues.push({
        type: "INVALID_OHLC",
        index,
        message: `Invalid OHLC ordering at ${timestamp}.`,
      });
      continue;
    }

    if (timestamp < previousTimestamp) outOfOrderDetected = true;
    previousTimestamp = timestamp;
    candles.push([timestamp, o, h, l, c, v]);
  }

  if (outOfOrderDetected) {
    candles.sort((a, b) => a[0] - b[0]);
  }

  return { candles, issues, outOfOrderDetected, filteredOutsideRange };
}

export interface DedupeResult {
  candles: CompactCandle[];
  duplicates: number;
  duplicateConflicts: number;
  conflictIssues: DataIssue[];
}

export interface MergeCandleChunksResult extends DedupeResult {
  outOfOrderDetected: boolean;
}

function sameCandle(a: CompactCandle, b: CompactCandle): boolean {
  return (
    a[1] === b[1] &&
    a[2] === b[2] &&
    a[3] === b[3] &&
    a[4] === b[4] &&
    a[5] === b[5]
  );
}

/** O(n) adjacent dedupe for already sorted provider chunks. */
export function dedupeSortedCandles(
  candles: readonly CompactCandle[],
): DedupeResult {
  if (candles.length === 0) {
    return {
      candles: [],
      duplicates: 0,
      duplicateConflicts: 0,
      conflictIssues: [],
    };
  }

  const result: CompactCandle[] = [candles[0]];
  const conflictIssues: DataIssue[] = [];
  let duplicates = 0;
  let duplicateConflicts = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = result[result.length - 1];

    if (current[0] !== previous[0]) {
      result.push(current);
      continue;
    }

    duplicates += 1;
    if (!sameCandle(previous, current)) {
      duplicateConflicts += 1;
      conflictIssues.push({
        type: "DUPLICATE_CONFLICT",
        index,
        message: `Conflicting duplicate candle at ${current[0]}; first value retained.`,
      });
    }
  }

  return { candles: result, duplicates, duplicateConflicts, conflictIssues };
}

/**
 * Combines independently sorted provider chunks into one chronological,
 * timestamp-unique stream. The fast path stays O(n); a global sort is used
 * only when a chunk boundary arrives out of order.
 */
export function mergeAndDedupeCandleChunks(
  chunks: readonly (readonly CompactCandle[])[],
): MergeCandleChunksResult {
  const combined: CompactCandle[] = [];
  let outOfOrderDetected = false;

  for (const chunk of chunks) {
    for (const candle of chunk) {
      if (
        combined.length > 0 &&
        candle[0] < combined[combined.length - 1][0]
      ) {
        outOfOrderDetected = true;
      }
      combined.push(candle);
    }
  }

  if (outOfOrderDetected) {
    combined.sort((left, right) => left[0] - right[0]);
  }

  return {
    ...dedupeSortedCandles(combined),
    outOfOrderDetected,
  };
}
