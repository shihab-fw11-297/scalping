import { performance } from "node:perf_hooks";
import { aggregateAllTimeframes, calculateLatestRollingWindow } from "../src/lib/market/aggregate";
import { analyzeCandleBehaviourWindow, summarizeCandleBehaviour } from "../src/lib/market/behaviour";
import { detectGaps } from "../src/lib/market/gaps";
import { analyzePriceBehaviourWindow, summarizePriceBehaviour } from "../src/lib/market/price-behaviour";
import { dedupeSortedCandles } from "../src/lib/market/normalize";
import { createTradeManagementIndex } from "../src/lib/market/trade-management";
import type { CompactCandle } from "../src/lib/market/types";

function generate(count: number): CompactCandle[] {
  const candles = new Array<CompactCandle>(count);
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
    candles[index] = [start + index * 60_000, open, high, low, close, 1];
    price = close;
  }

  return candles;
}

const input = generate(100_000);
const requestFromMs = input[0][0];
const requestToMs = input.at(-1)![0] + 60_000;
const schedule = { mode: "NEW_YORK_17" as const };
const memoryBefore = process.memoryUsage().heapUsed;
const started = performance.now();
const deduped = dedupeSortedCandles(input);
const gaps = detectGaps(deduped.candles, 60_000, schedule);
const aggregated = aggregateAllTimeframes(deduped.candles, {
  requestFromMs,
  requestToMs,
  weekendSchedule: schedule,
  dailyBoundaryMode: "NEW_YORK_17",
});
const rolling = calculateLatestRollingWindow(deduped.candles, 300);
const summaries = [
  summarizeCandleBehaviour(deduped.candles),
  summarizeCandleBehaviour(aggregated.M5.candles),
  summarizeCandleBehaviour(aggregated.M15.candles),
  summarizeCandleBehaviour(aggregated.H1.candles),
  summarizeCandleBehaviour(aggregated.D1.candles),
];
const latestWindow = analyzeCandleBehaviourWindow(deduped.candles, 95_000, 5_000);
const priceSummaries = [
  summarizePriceBehaviour(deduped.candles),
  summarizePriceBehaviour(aggregated.M5.candles),
  summarizePriceBehaviour(aggregated.M15.candles),
  summarizePriceBehaviour(aggregated.H1.candles),
  summarizePriceBehaviour(aggregated.D1.candles),
];
const latestPriceWindow = analyzePriceBehaviourWindow(deduped.candles, 95_000, 5_000);
const datasets = {
  M1: { candles: deduped.candles, completeness: Array.from({ length: deduped.candles.length }, () => ({ actualChildren: 1, expectedChildren: 1, fullIntervalChildren: 1, expectedClosedChildren: 0, completenessPercent: 100, status: "COMPLETE" as const })) },
  M5: aggregated.M5,
  M15: aggregated.M15,
  H1: aggregated.H1,
  D1: aggregated.D1,
};
const phase7Index = createTradeManagementIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" });
const phase6Index = phase7Index.signalIndex;
const marketStateResult = {
  summary: phase6Index.marketStateSummary,
  latest: phase6Index.latestMarketState,
};
const phase5Result = {
  summary: phase6Index.hypothesisOpportunitySummary,
  latest: phase6Index.latestHypothesisOpportunity,
};
const phase6Result = { summary: phase6Index.summary, latest: phase6Index.latest };
const phase7Result = { summary: phase7Index.summary, latest: phase7Index.latest };
const duration = performance.now() - started;
const memoryAfter = process.memoryUsage().heapUsed;

console.table({
  input: input.length,
  M5: aggregated.M5.candles.length,
  M15: aggregated.M15.candles.length,
  H1: aggregated.H1.candles.length,
  D1: aggregated.D1.candles.length,
  summaryCandles: summaries.reduce((sum, summary) => sum + summary.candleCount, 0),
  gaps: gaps.gaps.length,
  rollingCandles: rolling?.candlesPresent ?? 0,
  windowFeatures: latestWindow.length,
  priceSummaryCandles: priceSummaries.reduce((sum, summary) => sum + summary.candleCount, 0),
  priceWindowFeatures: latestPriceWindow.length,
  marketStateSamples: marketStateResult.summary.sampleCount,
  latestMarketState: marketStateResult.latest?.composite.state ?? "NONE",
  latestAlignment: marketStateResult.latest?.composite.alignment ?? "NONE",
  hypothesisSamples: phase5Result.summary.sampleCount,
  matureCandidates: phase5Result.summary.matureCandidateCount,
  latestHypothesis: phase5Result.latest?.leadingHypothesis ?? "NONE",
  latestOpportunityAvailability: phase5Result.latest?.opportunityAvailability ?? "NONE",
  phase6Samples: phase6Result.summary.sampleCount,
  confirmedSignals: phase6Result.summary.confirmedSignalCount,
  continuationSignals: phase6Result.summary.continuationSignalCount,
  duplicateSignalsSuppressed: phase6Result.summary.duplicateSuppressedCount,
  latestSignalLifecycle: phase6Result.latest?.lifecycle ?? "NONE",
  latestSignalAction: phase6Result.latest?.action ?? "NONE",
  phase7Plans: phase7Result.summary.createdPlanCount,
  phase7Qualified: phase7Result.summary.qualifiedPlanCount,
  phase7Rejected: phase7Result.summary.rejectedPlanCount,
  phase7Entered: phase7Result.summary.enteredPlanCount,
  phase7Ambiguous: phase7Result.summary.ambiguousPlanCount,
  phase7Completed: phase7Result.summary.completedPlanCount,
  latestTradeStatus: phase7Result.latest?.status ?? "NONE",
  latestEntry: phase7Result.latest?.entryZone?.preferred ?? 0,
  latestStop: phase7Result.latest?.structuralRisk?.stopLossPrice ?? 0,
  processingMs: Number(duration.toFixed(2)),
  heapDeltaMb: Number(((memoryAfter - memoryBefore) / 1024 / 1024).toFixed(2)),
});
