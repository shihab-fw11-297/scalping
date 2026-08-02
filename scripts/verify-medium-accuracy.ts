import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import { createVisibleRanges } from "../src/lib/market/analysis-range";
import { cleanMarketCandles } from "../src/lib/market/data-cleaning";
import {
  createTradeManagementIndex,
  createTradeReadyMarkersForWindow,
  simulateTradePlanCreation,
} from "../src/lib/market/trade-management";
import type {
  CandleCompleteness,
  CompactCandle,
  PriceBehaviour,
  Timeframe,
  TimeframeDataset,
} from "../src/lib/market/types";

const MINUTE = 60_000;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function complete(count: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({
    actualChildren: 1,
    expectedChildren: 1,
    fullIntervalChildren: 1,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE" as const,
  }));
}

function generate(count: number): CompactCandle[] {
  const candles: CompactCandle[] = [];
  const start = Date.UTC(2026, 0, 5, 22);
  let price = 2700;
  for (let index = 0; index < count; index += 1) {
    const regime = Math.floor(index / 720) % 4;
    const drift = regime === 0 ? 0.028 : regime === 1 ? -0.024 : regime === 2 ? 0.006 : -0.004;
    const oscillation = Math.sin(index / 19) * 0.07 + Math.sin(index / 71) * 0.05;
    const burst = index % 401 < 7 ? (regime % 2 === 0 ? 0.16 : -0.16) : 0;
    const open = price;
    const close = open + drift + oscillation + burst;
    const wick = 0.12 + Math.abs(Math.sin(index / 11)) * 0.08;
    candles.push([start + index * MINUTE, open, Math.max(open, close) + wick, Math.min(open, close) - wick, close, 1]);
    price = close;
  }
  return candles;
}

function datasetsOf(candles: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const aggregated = aggregateAllTimeframes(candles, {
    requestFromMs: candles[0][0],
    requestToMs: candles.at(-1)![0] + MINUTE,
    weekendSchedule: { mode: "NEW_YORK_17" },
    dailyBoundaryMode: "NEW_YORK_17",
  });
  return {
    M1: { candles, completeness: complete(candles.length) },
    M5: aggregated.M5,
    M15: aggregated.M15,
    H1: aggregated.H1,
    D1: aggregated.D1,
  };
}

const closureCandles: CompactCandle[] = [
  [Date.UTC(2026, 6, 31, 20, 59), 100, 100.2, 99.9, 100.1, 1],
  [Date.UTC(2026, 6, 31, 21, 22), 100.1, 100.1, 100.1, 100.1, 1],
  [Date.UTC(2026, 7, 2, 18, 25), 100.1, 100.1, 100.1, 100.1, 1],
  [Date.UTC(2026, 7, 2, 21, 1), 100.1, 100.3, 100, 100.2, 1],
];
const cleanedClosure = cleanMarketCandles(closureCandles, { mode: "NEW_YORK_17" });
invariant(cleanedClosure.closedMarketCandlesRemoved === 2, "Friday/Sunday closed-market candles were not removed.");
invariant(cleanedClosure.candles.length === 2, "Unexpected number of tradable candles after closure filtering.");

const staleStart = Date.UTC(2026, 6, 29, 12);
const staleCandles: CompactCandle[] = [
  [staleStart, 100, 100.5, 99.8, 100.2, 1],
  [staleStart + MINUTE, 100.2, 100.6, 100, 100.4, 1],
  [staleStart + 2 * MINUTE, 100.4, 100.4, 100.4, 100.4, 1],
  [staleStart + 3 * MINUTE, 100.4, 100.4, 100.4, 100.4, 1],
  [staleStart + 4 * MINUTE, 100.4, 100.4, 100.4, 100.4, 1],
  [staleStart + 5 * MINUTE, 100.4, 100.7, 100.3, 100.6, 1],
];
const cleanedStale = cleanMarketCandles(staleCandles, { mode: "NEW_YORK_17" });
invariant(cleanedStale.staleCandlesRemoved === 2, "Repeated stale quotes were not conservatively removed.");

const propagationSource = generate(5);
const propagationCompleteness = complete(5);
propagationCompleteness[2] = {
  ...propagationCompleteness[2],
  actualChildren: 0,
  completenessPercent: 0,
  status: "MISSING_DATA",
};
const propagation = aggregateAllTimeframes(propagationSource, {
  requestFromMs: propagationSource[0][0],
  requestToMs: propagationSource.at(-1)![0] + MINUTE,
  weekendSchedule: { mode: "NEW_YORK_17" },
  dailyBoundaryMode: "NEW_YORK_17",
  m1Completeness: propagationCompleteness,
});
invariant(propagation.M5.completeness[0].status === "MISSING_DATA", "Unsafe M1 source did not propagate to M5 completeness.");
invariant(propagation.M5.completeness[0].actualChildren === 4, "Derived valid-child count did not exclude unsafe M1 source.");

const rangeCandles = generate(2_000);
const rangeDatasets = datasetsOf(rangeCandles);
const displayFrom = rangeCandles[500][0];
const displayTo = rangeCandles[1_500][0];
const ranges = createVisibleRanges(rangeDatasets, displayFrom, displayTo);
invariant(ranges.M1.start === 500 && ranges.M1.total === 1_000, "Warm-up/display range separation failed.");

const feature: PriceBehaviour = {
  timestampMs: rangeCandles[500][0],
  netProgress3: 0.8,
  netProgress5: 1.2,
  netProgress10: 1.8,
  netProgress20: 2.2,
  grossTravel5: 1.5,
  grossTravel20: 3.5,
  efficiency3: 0.72,
  efficiency5: 0.68,
  efficiency10: 0.62,
  efficiency20: 0.55,
  speed3: 0.25,
  speed5: 0.24,
  speed10: 0.18,
  speed20: 0.11,
  averageOverlap5: 0.2,
  alternationRate5: 0.1,
  noiseScore: 22,
  rangeRegimeRatio: 1.2,
  phase: "BULLISH_RECOVERY",
  impulseDirection: "BULLISH",
  impulseStrength: 78,
  impulseBars: 5,
  pullbackDepthPercent: 35,
  pullbackBars: 3,
  recoverySpeedRatio: 1.4,
  breakState: "BULLISH_ACCEPTED",
  breakLevel: rangeCandles[500][4] - 0.1,
  breakLookback: 20,
  breakAgeBars: 1,
  momentumCondition: "ACCELERATING_BULLISH",
  accelerationRatio: 1.35,
  extensionVsAverageRange20: 1.1,
  freshnessScore: 82,
  lateEntryRisk: "LOW",
};
const plan = simulateTradePlanCreation({
  candles: rangeCandles,
  completeness: complete(rangeCandles.length),
  signalIndex: 500,
  family: "PRESSURE_RELEASE",
  direction: "BULLISH",
  candidateScore: 82,
  feature,
});
invariant(plan.targetSpace !== null, "Target-space plan was not created.");
if (plan.targetSpace.nearestObstacleClass === "SOFT") {
  invariant(plan.targetSpace.decisionObstacleClass !== null || plan.targetSpace.limitingFactor === "EXPECTED_10M_CAPACITY", "Minor M1 obstacle incorrectly limited target space.");
}
invariant(plan.quality !== null, "Trade quality assessment is missing.");
invariant(["A", "B", "C", "BLOCKED"].includes(plan.quality.grade), "Unknown trade grade.");

const rotation = simulateTradePlanCreation({
  candles: rangeCandles,
  completeness: complete(rangeCandles.length),
  signalIndex: 500,
  family: "TIMEFRAME_ROTATION",
  direction: "BULLISH",
  candidateScore: 95,
  feature,
});
invariant(rotation.rejectionReasons.includes("TIMEFRAME_ROTATION_CONTEXT_ONLY"), "Timeframe Rotation must be confluence-only.");

const fullCandles = generate(20_000);
const fullDatasets = datasetsOf(fullCandles);
const tradeIndex = createTradeManagementIndex(fullDatasets, { dailyBoundaryMode: "NEW_YORK_17" });
const gradeTotal = Object.values(tradeIndex.summary.gradeCounts).reduce((sum, count) => sum + count, 0);
invariant(gradeTotal === tradeIndex.summary.createdPlanCount, "Trade-grade accounting mismatch.");
invariant(tradeIndex.summary.tradeReadySignalCount <= tradeIndex.summary.qualifiedPlanCount, "Trade-ready count exceeds qualified plans.");
const markers = createTradeReadyMarkersForWindow(
  tradeIndex,
  "M1",
  fullCandles,
  0,
  fullCandles.length,
  "NEW_YORK_17",
);
invariant(markers.every((marker) => marker.markerKind === "TRADE_READY"), "Research marker leaked into trading markers.");
invariant(markers.every((marker) => marker.grade === "A" || marker.grade === "B"), "Non-A/B marker leaked into trading view.");
invariant(markers.length <= tradeIndex.summary.tradeReadySignalCount, "Window marker deduplication failed.");

console.log(JSON.stringify({
  ok: true,
  closureCandlesRemoved: cleanedClosure.closedMarketCandlesRemoved,
  staleCandlesRemoved: cleanedStale.staleCandlesRemoved,
  gapSafetyPropagatedToM5: propagation.M5.completeness[0].status === "MISSING_DATA",
  warmupCandles: ranges.M1.start,
  createdPlans: tradeIndex.summary.createdPlanCount,
  qualifiedPlans: tradeIndex.summary.qualifiedPlanCount,
  tradeReadySignals: tradeIndex.summary.tradeReadySignalCount,
  duplicateEpisodesSuppressed: tradeIndex.summary.duplicateEpisodeCount,
  gradeCounts: tradeIndex.summary.gradeCounts,
  chartMarkers: markers.length,
}, null, 2));
