import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import {
  analyzeTradeManagementAt,
  createTradeManagementIndex,
  createTradePlanHistory,
  simulateTradePlanCreation,
} from "../src/lib/market/trade-management";
import type { CandleCompleteness, CompactCandle, Timeframe, TimeframeDataset } from "../src/lib/market/types";

const MINUTE = 60_000;

function generate(count: number): CompactCandle[] {
  const candles: CompactCandle[] = [];
  const start = Date.UTC(2026, 0, 5, 22);
  let price = 2600;
  for (let index = 0; index < count; index += 1) {
    const slow = Math.sin(index / 113) * 0.12;
    const fast = Math.sin(index / 17) * 0.09;
    const regime = Math.floor(index / 900) % 4;
    const drift = regime === 0 ? 0.035 : regime === 1 ? -0.028 : regime === 2 ? 0.008 : -0.004;
    const burst = index % 347 < 8 ? (regime % 2 === 0 ? 0.18 : -0.18) : 0;
    const open = price;
    const close = open + drift + slow + fast + burst;
    const wick = 0.16 + Math.abs(Math.sin(index / 9)) * 0.12;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    candles.push([start + index * MINUTE, open, high, low, close, 1]);
    price = close;
  }
  return candles;
}

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

function datasetsOf(candles: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const from = candles[0][0];
  const to = candles.at(-1)![0] + MINUTE;
  const aggregated = aggregateAllTimeframes(candles, {
    requestFromMs: from,
    requestToMs: to,
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

const fullCandles = generate(40_000);

const constructionFeature = {
  timestampMs: fullCandles[500][0],
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
  phase: "BULLISH_RECOVERY" as const,
  impulseDirection: "BULLISH" as const,
  impulseStrength: 78,
  impulseBars: 5,
  pullbackDepthPercent: 35,
  pullbackBars: 3,
  recoverySpeedRatio: 1.4,
  breakState: "BULLISH_ACCEPTED" as const,
  breakLevel: fullCandles[500][4] - 0.1,
  breakLookback: 20 as const,
  breakAgeBars: 1,
  momentumCondition: "ACCELERATING_BULLISH" as const,
  accelerationRatio: 1.35,
  extensionVsAverageRange20: 1.1,
  freshnessScore: 82,
  lateEntryRisk: "LOW" as const,
};
for (const family of ["PRESSURE_RELEASE", "FAILED_BREAK_REVERSAL", "IMPULSE_RELOAD", "TIMEFRAME_ROTATION"] as const) {
  const created = simulateTradePlanCreation({
    candles: fullCandles,
    completeness: completeness(fullCandles.length),
    signalIndex: 500,
    family,
    direction: "BULLISH",
    candidateScore: 88,
    feature: constructionFeature,
  });
  assert.equal(created.family, family);
  if (!created.entryZone || !created.structuralRisk || !created.targetSpace) {
    throw new Error(`${family} did not create a complete static plan.`);
  }
  assert.ok(created.targetSpace.targets.length >= 1);
  if (created.targetSpace.targets.some((target) => target.name === "TP3")) {
    assert.ok(created.targetSpace.targets.some((target) => target.name === "TP2"), "TP3 cannot exist without TP2");
  }
  assert.equal(created.enteredAtMs, null);
}
// A higher-timeframe candle containing the signal M1 candle must not become a prior target obstacle.
const strictPriorStart = Date.UTC(2026, 0, 7, 12);
const strictPriorCandles: CompactCandle[] = Array.from({ length: 80 }, (_, index) => {
  const open = 100 + index * 0.005;
  const close = open + 0.005;
  return [strictPriorStart + index * MINUTE, open, close + 0.15, open - 0.15, close, 1];
});
const strictSignalIndex = 50;
const strictSignalOpen = strictPriorCandles[strictSignalIndex][0];
const m5Candles: CompactCandle[] = Array.from({ length: 8 }, (_, index) => {
  const timestamp = strictSignalOpen - (7 - index) * 5 * MINUTE;
  const high = index === 3 ? 102 : index === 7 ? 100.9 : 101.4;
  return [timestamp, 100.2, high, 99.8, 100.3, 5];
});
const strictFeature = {
  ...constructionFeature,
  timestampMs: strictPriorCandles[strictSignalIndex][0],
  breakLevel: 100.5,
};
const strictPriorPlan = simulateTradePlanCreation({
  candles: strictPriorCandles,
  completeness: completeness(strictPriorCandles.length),
  signalIndex: strictSignalIndex,
  family: "PRESSURE_RELEASE",
  direction: "BULLISH",
  candidateScore: 90,
  feature: strictFeature,
  higherTimeframeDatasets: {
    M5: { candles: m5Candles, completeness: completeness(m5Candles.length) },
  },
});
assert.equal(strictPriorPlan.targetSpace?.nearestObstacleSource, "M5_SWING");
assert.equal(strictPriorPlan.targetSpace?.nearestObstaclePrice, 102);
assert.notEqual(strictPriorPlan.targetSpace?.nearestObstaclePrice, 100.9, "signal-containing M5 candle leaked into target space");

const incompleteCoverage = completeness(fullCandles.length);
incompleteCoverage[495] = { ...incompleteCoverage[495], status: "MISSING_DATA", completenessPercent: 0, actualChildren: 0 };
const incompletePlan = simulateTradePlanCreation({
  candles: fullCandles,
  completeness: incompleteCoverage,
  signalIndex: 500,
  family: "IMPULSE_RELOAD",
  direction: "BULLISH",
  candidateScore: 88,
  feature: constructionFeature,
});
assert.equal(incompletePlan.status, "REJECTED");
assert.ok(incompletePlan.rejectionReasons.includes("PARTIAL_SOURCE_DATA"));

const started = performance.now();
const fullIndex = createTradeManagementIndex(datasetsOf(fullCandles), { dailyBoundaryMode: "NEW_YORK_17" });
const elapsed = performance.now() - started;
assert.equal(fullIndex.summary.sampleCount, fullCandles.length);
assert.ok(fullIndex.summary.createdPlanCount > 0, "expected Phase 7 to create at least one plan");
assert.equal(
  fullIndex.summary.createdPlanCount,
  fullIndex.summary.qualifiedPlanCount + fullIndex.summary.rejectedPlanCount,
  "created plan accounting mismatch",
);
assert.ok(fullIndex.summary.averageTp1RiskReward >= 1.49, "TP1 should respect minimum R:R");
const familyCounts = Object.fromEntries(
  ["PRESSURE_RELEASE", "FAILED_BREAK_REVERSAL", "IMPULSE_RELOAD", "TIMEFRAME_ROTATION"].map((family) => [
    family,
    fullIndex.plans.filter((plan) => plan.family === family).length,
  ]),
);
assert.ok(Object.values(familyCounts).some((count) => count > 0), "no opportunity family created a plan");

for (const plan of fullIndex.plans) {
  assert.ok(plan.entryZone.lower <= plan.entryZone.preferred && plan.entryZone.preferred <= plan.entryZone.upper);
  if (plan.direction === "BULLISH") {
    assert.ok(plan.structuralRisk.stopLossPrice < plan.entryZone.lower || plan.initialStatus === "REJECTED");
    assert.ok(plan.targetSpace.targets[0].price > plan.entryZone.preferred);
  } else {
    assert.ok(plan.structuralRisk.stopLossPrice > plan.entryZone.upper || plan.initialStatus === "REJECTED");
    assert.ok(plan.targetSpace.targets[0].price < plan.entryZone.preferred);
  }
  assert.ok(plan.entryZone.expiresAtMs > plan.signalTimestampMs);
  assert.ok(
    plan.targetSpace.availableDistance <= plan.targetSpace.expected10MinuteCapacity + 1e-5,
    "target distance exceeded prior-only 10-minute capacity",
  );
  assert.ok(plan.targetSpace.obstacleCandidatesEvaluated >= 0);
  assert.ok(plan.limitations.includes("HISTORICAL_OHLC_ONLY"));
  assert.ok(plan.limitations.includes("LIVE_SPREAD_UNVERIFIED"));
  assert.ok(plan.limitations.includes("BROKER_CONTRACT_UNAVAILABLE"));
  if (plan.targetSpace.usedExpansionFallback) {
    assert.equal(plan.targetSpace.nearestObstaclePrice, null);
    assert.equal(plan.targetSpace.nearestObstacleSource, null);
    assert.equal(plan.targetSpace.limitingFactor, "EXPECTED_10M_CAPACITY");
    assert.ok(
      Math.abs(plan.targetSpace.availableDistance - plan.targetSpace.expected10MinuteCapacity) <= 1e-5,
      "no-obstacle fallback invented additional target space",
    );
  }
  if (plan.initialStatus !== "REJECTED") {
    const tp1Distance = Math.abs(plan.targetSpace.targets[0].price - plan.entryZone.preferred);
    assert.ok(tp1Distance <= plan.targetSpace.availableDistance + 1e-5);
  }
}

const enteredPlan = fullIndex.plans.find((plan) => plan.enteredIndex >= 0);
assert.ok(enteredPlan, "expected at least one entered plan");
const enteredSlot = enteredPlan!.enteredIndex * 4 + enteredPlan!.familyIndex;
assert.equal(fullIndex.arrays.mfe[enteredSlot], 0, "entry-candle pre-fill high leaked into MFE");
assert.equal(fullIndex.arrays.mae[enteredSlot], 0, "entry-candle pre-fill low leaked into MAE");
const enteredHistory = createTradePlanHistory(
  fullIndex,
  "00000000-0000-4000-8000-000000000000",
  enteredPlan!.id,
  1,
);
assert.ok(enteredHistory.items[0]?.filledExecution, "actual filled-entry risk metrics are missing");
assert.ok((enteredHistory.items[0]?.filledExecution?.actualTotalRiskWithCosts ?? 0) > 0);
assert.ok(Number.isFinite(enteredHistory.items[0]?.filledExecution?.actualRiskRewardToTp1 ?? Number.NaN));

const firstPlan = fullIndex.plans[0];
assert.ok(firstPlan);
const signalSnapshot = analyzeTradeManagementAt(fullIndex, firstPlan.signalTimestampMs);
assert.ok(signalSnapshot);
assert.equal(signalSnapshot?.signalTimestampMs, firstPlan.signalTimestampMs);
assert.equal(signalSnapshot?.enteredAtMs, null, "entry cannot be filled inside the already-closed signal candle");
assert.equal(signalSnapshot?.maximumFavourableExcursion, 0, "future MFE leaked into signal snapshot");
assert.equal(signalSnapshot?.maximumAdverseExcursion, 0, "future MAE leaked into signal snapshot");
assert.ok(!signalSnapshot?.reasons.includes("TP1_REACHED"), "future target reason leaked into signal snapshot");
assert.ok(!signalSnapshot?.rejectionReasons.includes("STRUCTURE_INVALIDATED"), "future invalidation leaked into signal snapshot");

const supersededPlan = fullIndex.plans.find((plan) => {
  if (plan.supersededIndex < 0) return false;
  const atSignal = analyzeTradeManagementAt(fullIndex, plan.signalTimestampMs);
  return atSignal?.planId === plan.planId;
});
assert.ok(supersededPlan, "expected at least one testable superseded plan");
const supersededAtSignal = analyzeTradeManagementAt(fullIndex, supersededPlan!.signalTimestampMs);
assert.ok(
  !supersededAtSignal?.rejectionReasons.includes("SUPERSEDED_BY_NEW_SIGNAL"),
  "future supersession leaked into the original signal snapshot",
);
const supersededHistory = createTradePlanHistory(
  fullIndex,
  "00000000-0000-4000-8000-000000000000",
  supersededPlan!.id,
  1,
);
assert.ok(
  supersededHistory.items[0]?.rejectionReasons.includes("SUPERSEDED_BY_NEW_SIGNAL"),
  "final history did not preserve the supersession reason",
);

const anchorIndex = Math.min(30_000, fullCandles.length - 1);
const anchorTimestamp = fullCandles[anchorIndex][0] + MINUTE;
const fullAtAnchor = analyzeTradeManagementAt(fullIndex, anchorTimestamp);
const prefixCandles = fullCandles.slice(0, anchorIndex + 1);
const prefixIndex = createTradeManagementIndex(datasetsOf(prefixCandles), { dailyBoundaryMode: "NEW_YORK_17" });
const prefixAtAnchor = analyzeTradeManagementAt(prefixIndex, anchorTimestamp);
assert.deepEqual(fullAtAnchor, prefixAtAnchor, "future candles changed the Phase 7 snapshot");

const history = createTradePlanHistory(fullIndex, "00000000-0000-4000-8000-000000000000", 0, 25);
assert.equal(history.items.length, Math.min(25, history.total));
assert.ok(history.items.every((item) => item.targetSpace.targets.length >= 1));
assert.ok(history.items.every((item) => item.structuralRisk.riskDistance > 0));
assert.ok(history.items.every((item) => item.executionCosts.liveVerified === false));
assert.ok(history.items.every((item) => item.semantics === "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION"));
assert.ok(history.items.every((item) => item.finalHealth.length > 0));
assert.ok(history.items.every((item) => item.maximumFavourableExcursion >= 0));
assert.ok(history.items.every((item) => item.maximumAdverseExcursion >= 0));

console.table({
  samples: fullIndex.summary.sampleCount,
  plans: fullIndex.summary.createdPlanCount,
  qualified: fullIndex.summary.qualifiedPlanCount,
  rejected: fullIndex.summary.rejectedPlanCount,
  entered: fullIndex.summary.enteredPlanCount,
  expired: fullIndex.summary.expiredPlanCount,
  invalidated: fullIndex.summary.invalidatedPlanCount,
  ambiguous: fullIndex.summary.ambiguousPlanCount,
  tp1: fullIndex.summary.tp1HitCount,
  tp2: fullIndex.summary.tp2HitCount,
  completed: fullIndex.summary.completedPlanCount,
  processingMs: Number(elapsed.toFixed(2)),
  ...familyCounts,
});
console.log("Phase 7 verification passed.");
