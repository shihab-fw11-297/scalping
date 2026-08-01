import type { CompactCandle, GapRecord } from "./types";
import {
  isExpectedForexClosure,
  type WeekendSchedule,
} from "./market-session";

export interface GapDetectionResult {
  gaps: GapRecord[];
  missingTradableCandles: number;
  expectedClosedCandles: number;
}

/**
 * Single sequence traversal. Missing intervals are classified minute-by-minute
 * only inside detected gaps, which keeps normal data processing O(n).
 */
export function detectGaps(
  candles: readonly CompactCandle[],
  expectedIntervalMs: number,
  schedule: WeekendSchedule,
): GapDetectionResult {
  const gaps: GapRecord[] = [];
  let missingTradableCandles = 0;
  let expectedClosedCandles = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const previousTime = candles[index - 1][0];
    const currentTime = candles[index][0];
    const delta = currentTime - previousTime;

    if (delta <= expectedIntervalMs) continue;

    const totalMissing = Math.max(0, Math.floor(delta / expectedIntervalMs) - 1);
    if (totalMissing === 0) continue;

    let closed = 0;
    let tradable = 0;
    for (
      let timestamp = previousTime + expectedIntervalMs;
      timestamp < currentTime;
      timestamp += expectedIntervalMs
    ) {
      if (isExpectedForexClosure(timestamp, schedule)) closed += 1;
      else tradable += 1;
    }

    missingTradableCandles += tradable;
    expectedClosedCandles += closed;

    gaps.push({
      fromTimestampMs: previousTime,
      toTimestampMs: currentTime,
      totalMissingCandles: totalMissing,
      missingTradableCandles: tradable,
      expectedClosedCandles: closed,
      classification:
        tradable === 0
          ? "EXPECTED_MARKET_CLOSURE"
          : closed === 0
            ? "MISSING_TRADABLE_INTERVAL"
            : "MIXED_CLOSURE_AND_MISSING",
    });
  }

  return { gaps, missingTradableCandles, expectedClosedCandles };
}
