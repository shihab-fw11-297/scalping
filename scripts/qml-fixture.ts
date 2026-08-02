import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import type {
  CandleCompleteness,
  CompactCandle,
  Timeframe,
  TimeframeDataset,
} from "../src/lib/market/types";

export const MINUTE_MS = 60_000;

function completeness(count: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({
    actualChildren: 1,
    expectedChildren: 1,
    fullIntervalChildren: 1,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE" as const,
  }));
}

function isTradableMinute(timestampMs: number): boolean {
  const date = new Date(timestampMs);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 21) return false;
  if (day === 5 && hour >= 21) return false;
  return true;
}

/**
 * Deterministic multi-regime fixture. It is intentionally synthetic and is used
 * only for regression/no-lookahead validation, never as profitability evidence.
 */
export function generateQmlFixture(count: number): CompactCandle[] {
  const candles: CompactCandle[] = [];
  let timestampMs = Date.UTC(2026, 0, 5, 22);
  let price = 2_700;
  for (let index = 0; index < count; index += 1) {
    while (!isTradableMinute(timestampMs)) timestampMs += MINUTE_MS;
    const regime = Math.floor(index / 720) % 4;
    const drift = regime === 0 ? 0.028 : regime === 1 ? -0.024 : regime === 2 ? 0.006 : -0.004;
    const oscillation = Math.sin(index / 19) * 0.07 + Math.sin(index / 71) * 0.05;
    const burst = index % 401 < 7 ? (regime % 2 === 0 ? 0.16 : -0.16) : 0;
    const open = price;
    const close = open + drift + oscillation + burst;
    const wick = 0.12 + Math.abs(Math.sin(index / 11)) * 0.08;
    candles.push([
      timestampMs,
      open,
      Math.max(open, close) + wick,
      Math.min(open, close) - wick,
      close,
      1,
    ]);
    price = close;
    timestampMs += MINUTE_MS;
  }
  return candles;
}

export function datasetsFrom(candles: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const aggregated = aggregateAllTimeframes(candles, {
    requestFromMs: candles[0][0],
    requestToMs: candles.at(-1)![0] + MINUTE_MS,
    weekendSchedule: { mode: "NEW_YORK_17" },
    dailyBoundaryMode: "NEW_YORK_17",
  });
  return {
    M1: { candles, completeness: completeness(candles.length) },
    M5: aggregated.M5,
    M15: aggregated.M15,
    H1: aggregated.H1,
    D1: aggregated.D1,
  };
}
