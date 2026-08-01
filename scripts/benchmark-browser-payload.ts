import { performance } from "node:perf_hooks";
import { analyzeCandleBehaviourWindow } from "../src/lib/market/behaviour";
import { analyzePriceBehaviourWindow } from "../src/lib/market/price-behaviour";
import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import {
  analyzeMultiTimeframeStateAt,
  createMultiTimeframeStateIndex,
} from "../src/lib/market/multi-timeframe-state";
import {
  analyzeHypothesesAndOpportunitiesAt,
  createHypothesisOpportunityIndex,
} from "../src/lib/market/hypothesis-opportunity";
import {
  analyzeSignalDecisionAt,
  createSignalDecisionIndex,
  createSignalMarkersForWindow,
} from "../src/lib/market/signal-decision";
import {
  analyzeTradeManagementAt,
  createTradeManagementIndex,
} from "../src/lib/market/trade-management";
import type { CandleBehaviourView, CandleCompleteness, CompactCandle, PriceBehaviourView } from "../src/lib/market/types";

const count = 5_000;
const start = Date.UTC(2026, 0, 1);
const candles: CompactCandle[] = new Array(count);
const completeness: CandleCompleteness[] = new Array(count);
let price = 2600;

for (let index = 0; index < count; index += 1) {
  const open = price;
  const close = open + Math.sin(index / 17) * 0.1;
  candles[index] = [start + index * 60_000, open, Math.max(open, close) + 0.2, Math.min(open, close) - 0.2, close, 1];
  completeness[index] = {
    actualChildren: 1,
    expectedChildren: 1,
    fullIntervalChildren: 1,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE",
  };
  price = close;
}

const started = performance.now();
const behaviours: CandleBehaviourView[] = analyzeCandleBehaviourWindow(candles, 0, candles.length).map((item) => ({
  timestampMs: item.timestampMs,
  direction: item.direction,
  range: item.range,
  bodyToRange: item.bodyToRange,
  rangeVsAverage20: item.rangeVsAverage20,
  overlapWithPrevious: item.overlapWithPrevious,
  breakBehaviour: item.breakBehaviour,
  maximumHighBreakLookback: item.maximumHighBreakLookback,
  maximumLowBreakLookback: item.maximumLowBreakLookback,
  primaryTag: item.primaryTag,
  intensityScore: item.intensityScore,
}));
const priceBehaviours: PriceBehaviourView[] = analyzePriceBehaviourWindow(candles, 0, candles.length).map((item) => ({
  timestampMs: item.timestampMs,
  phase: item.phase,
  efficiency5: item.efficiency5,
  efficiency20: item.efficiency20,
  noiseScore: item.noiseScore,
  impulseDirection: item.impulseDirection,
  impulseStrength: item.impulseStrength,
  impulseBars: item.impulseBars,
  pullbackDepthPercent: item.pullbackDepthPercent,
  pullbackBars: item.pullbackBars,
  recoverySpeedRatio: item.recoverySpeedRatio,
  breakState: item.breakState,
  breakLevel: item.breakLevel,
  breakLookback: item.breakLookback,
  momentumCondition: item.momentumCondition,
  accelerationRatio: item.accelerationRatio,
  extensionVsAverageRange20: item.extensionVsAverageRange20,
  freshnessScore: item.freshnessScore,
  lateEntryRisk: item.lateEntryRisk,
}));

const derived = aggregateAllTimeframes(candles, {
  requestFromMs: candles[0][0],
  requestToMs: candles.at(-1)![0] + 60_000,
  weekendSchedule: { mode: "NEW_YORK_17" },
  dailyBoundaryMode: "NEW_YORK_17",
});
const datasets = {
  M1: { candles, completeness },
  M5: derived.M5,
  M15: derived.M15,
  H1: derived.H1,
  D1: derived.D1,
};
const marketStateAtWindowEnd = analyzeMultiTimeframeStateAt(
  createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" }),
  candles.at(-1)![0] + 60_000,
);
const hypothesisOpportunityAtWindowEnd = analyzeHypothesesAndOpportunitiesAt(
  createHypothesisOpportunityIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" }),
  candles.at(-1)![0] + 60_000,
);
const signalIndex = createSignalDecisionIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" });
const signalDecisionAtWindowEnd = analyzeSignalDecisionAt(
  signalIndex,
  candles.at(-1)![0] + 60_000,
);
const signalMarkers = createSignalMarkersForWindow(
  signalIndex,
  "M1",
  candles,
  0,
  candles.length,
  "NEW_YORK_17",
);
const tradePlanAtWindowEnd = analyzeTradeManagementAt(
  createTradeManagementIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" }),
  candles.at(-1)![0] + 60_000,
);

const payload = JSON.stringify({
  analysisId: "00000000-0000-4000-8000-000000000000",
  timeframe: "M1",
  offset: 95_000,
  limit: count,
  total: 100_000,
  candles,
  completeness,
  behaviours,
  priceBehaviours,
  signalMarkers,
  marketStateAtWindowEnd,
  hypothesisOpportunityAtWindowEnd,
  signalDecisionAtWindowEnd,
  tradePlanAtWindowEnd,
});
const durationMs = performance.now() - started;
const payloadMb = Buffer.byteLength(payload) / 1024 / 1024;

if (payloadMb > 8) {
  throw new Error(`Browser window payload is too large: ${payloadMb.toFixed(2)} MB.`);
}

console.table({
  fullDatasetCandles: 100_000,
  browserWindowCandles: count,
  signalMarkers: signalMarkers.length,
  payloadMb: Number(payloadMb.toFixed(2)),
  serializeAndFeatureMs: Number(durationMs.toFixed(2)),
});
