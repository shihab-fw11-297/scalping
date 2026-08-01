import { describe, expect, it } from "vitest";
import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import {
  analyzeTradeManagementAt,
  createTradeManagementIndex,
  simulateTradePlanCreation,
} from "../src/lib/market/trade-management";
import type { CandleCompleteness, CompactCandle, Timeframe, TimeframeDataset } from "../src/lib/market/types";

const MINUTE = 60_000;

function data(count: number): CompactCandle[] {
  const result: CompactCandle[] = [];
  let price = 2600;
  const start = Date.UTC(2026, 0, 5, 22);
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open + Math.sin(index / 19) * 0.12 + (Math.floor(index / 700) % 2 === 0 ? 0.025 : -0.025);
    result.push([start + index * MINUTE, open, Math.max(open, close) + 0.2, Math.min(open, close) - 0.2, close, 1]);
    price = close;
  }
  return result;
}

function coverage(count: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({ actualChildren: 1, expectedChildren: 1, fullIntervalChildren: 1, expectedClosedChildren: 0, completenessPercent: 100, status: "COMPLETE" as const }));
}

function datasets(candles: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const aggregated = aggregateAllTimeframes(candles, {
    requestFromMs: candles[0][0],
    requestToMs: candles.at(-1)![0] + MINUTE,
    weekendSchedule: { mode: "NEW_YORK_17" },
    dailyBoundaryMode: "NEW_YORK_17",
  });
  return { M1: { candles, completeness: coverage(candles.length) }, M5: aggregated.M5, M15: aggregated.M15, H1: aggregated.H1, D1: aggregated.D1 };
}

describe("Phase 7 trade management", () => {
  it("creates structurally bounded plans without future leakage", () => {
    const candles = data(12_000);
    const index = createTradeManagementIndex(datasets(candles), { dailyBoundaryMode: "NEW_YORK_17" });
    expect(index.summary.createdPlanCount).toBeGreaterThan(0);
    const first = index.plans[0];
    const snapshot = analyzeTradeManagementAt(index, first.signalTimestampMs);
    expect(snapshot?.enteredAtMs).toBeNull();
    expect(snapshot?.maximumFavourableExcursion).toBe(0);
    expect(snapshot?.maximumAdverseExcursion).toBe(0);
    expect(first.targetSpace.targets[0].riskReward).toBeGreaterThanOrEqual(1.5);
    expect(first.targetSpace.availableDistance).toBeLessThanOrEqual(first.targetSpace.expected10MinuteCapacity + 1e-5);
    expect(first.targetSpace.obstacleCandidatesEvaluated).toBeGreaterThanOrEqual(0);
    expect(first.rejectionReasons).not.toContain("LIVE_SPREAD_UNVERIFIED");
    expect(first.limitations).toContain("HISTORICAL_OHLC_ONLY");
    expect(first.limitations).toContain("LIVE_SPREAD_UNVERIFIED");
    expect(first.limitations).toContain("BROKER_CONTRACT_UNAVAILABLE");
    expect(index.summary.limitationCounts.LIVE_SPREAD_UNVERIFIED).toBe(index.summary.createdPlanCount);
  });

  it("rejects a plan when its structural lookback contains incomplete source data", () => {
    const candles = data(100);
    const completeness = coverage(candles.length);
    completeness[85] = { ...completeness[85], status: "MISSING_DATA", completenessPercent: 0, actualChildren: 0 };
    const plan = simulateTradePlanCreation({
      candles,
      completeness,
      signalIndex: 99,
      family: "IMPULSE_RELOAD",
      direction: "BULLISH",
      candidateScore: 88,
      feature: {
        timestampMs: candles[99][0],
        netProgress3: 0.8, netProgress5: 1.2, netProgress10: 1.8, netProgress20: 2.2,
        grossTravel5: 1.5, grossTravel20: 3.5, efficiency3: 0.72, efficiency5: 0.68,
        efficiency10: 0.62, efficiency20: 0.55, speed3: 0.25, speed5: 0.24, speed10: 0.18, speed20: 0.11,
        averageOverlap5: 0.2, alternationRate5: 0.1, noiseScore: 22, rangeRegimeRatio: 1.2,
        phase: "BULLISH_RECOVERY", impulseDirection: "BULLISH", impulseStrength: 78, impulseBars: 5,
        pullbackDepthPercent: 35, pullbackBars: 3, recoverySpeedRatio: 1.4,
        breakState: "BULLISH_ACCEPTED", breakLevel: candles[99][4] - 0.1, breakLookback: 20, breakAgeBars: 1,
        momentumCondition: "ACCELERATING_BULLISH", accelerationRatio: 1.35,
        extensionVsAverageRange20: 1.1, freshnessScore: 82, lateEntryRisk: "LOW",
      },
    });
    expect(plan.status).toBe("REJECTED");
    expect(plan.rejectionReasons).toContain("PARTIAL_SOURCE_DATA");
  });
});
