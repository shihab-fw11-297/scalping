function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}
import { aggregateAllTimeframes } from "../src/lib/market/aggregate";
import { summarizeCandleBehaviour } from "../src/lib/market/behaviour";
import { summarizePriceBehaviour } from "../src/lib/market/price-behaviour";
import { createAnalysisReport, createAnalysisReportSummary } from "../src/lib/market/report";
import { getOrCreateTradeManagementIndex } from "../src/lib/market/trade-management";
import { createMarketWindow } from "../src/lib/market/window";
import type {
  CachedAnalysis,
  CandleCompleteness,
  CandleCoverageStatus,
  CompactCandle,
  Timeframe,
  TimeframeDataset,
} from "../src/lib/market/types";

const MINUTE = 60_000;
const TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "H1", "D1"];

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
    candles.push([
      start + index * MINUTE,
      open,
      Math.max(open, close) + wick,
      Math.min(open, close) - wick,
      close,
      1,
    ]);
    price = close;
  }
  return candles;
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

const candles = generate(40_000);
const from = candles[0][0];
const to = candles.at(-1)![0] + MINUTE;
const derived = aggregateAllTimeframes(candles, {
  requestFromMs: from,
  requestToMs: to,
  weekendSchedule: { mode: "NEW_YORK_17" },
  dailyBoundaryMode: "NEW_YORK_17",
});
const datasets: Record<Timeframe, TimeframeDataset> = {
  M1: { candles, completeness: complete(candles.length) },
  M5: derived.M5,
  M15: derived.M15,
  H1: derived.H1,
  D1: derived.D1,
};
const behaviourSummaries = Object.fromEntries(
  TIMEFRAMES.map((timeframe) => [timeframe, summarizeCandleBehaviour(datasets[timeframe].candles)]),
) as CachedAnalysis["behaviourSummaries"];
const priceBehaviourSummaries = Object.fromEntries(
  TIMEFRAMES.map((timeframe) => [timeframe, summarizePriceBehaviour(datasets[timeframe].candles)]),
) as CachedAnalysis["priceBehaviourSummaries"];
const tradeIndex = getOrCreateTradeManagementIndex(datasets, {
  dailyBoundaryMode: "NEW_YORK_17",
  settings: {
    assumedSpreadPrice: 0.25,
    assumedSlippagePrice: 0.1,
    minimumRiskReward: 1.5,
    maximumRiskInAverageRanges: 3.5,
  },
});
const coverage = Object.fromEntries(TIMEFRAMES.map((timeframe) => [
  timeframe,
  {
    COMPLETE: datasets[timeframe].candles.length,
    PARTIAL_REQUEST_BOUNDARY: 0,
    EXPECTED_MARKET_CLOSURE: 0,
    BOUNDARY_AND_CLOSURE: 0,
    MISSING_DATA: 0,
    PARTIAL_MISSING_DATA: 0,
    OVERFULL: 0,
  } satisfies Record<CandleCoverageStatus, number>,
])) as CachedAnalysis["quality"]["coverageStatusByTimeframe"];
const base = {
  id: "00000000-0000-4000-8000-000000000001",
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 60_000,
  meta: {
    symbol: "XAUUSD",
    source: "FINAGE" as const,
    requestedFromUtc: new Date(from).toISOString(),
    requestedToUtc: new Date(to).toISOString(),
    intervalSemantics: "[from,to)" as const,
    sourceTimeframe: "M1" as const,
    fetchChunks: 1,
    processingMs: 1,
    cacheExpiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    weekendScheduleMode: "NEW_YORK_17" as const,
    dailyBoundaryMode: "NEW_YORK_17" as const,
    dailyBoundaryDescription: "New York 17:00",
    maxWindowCandles: 5_000,
    tradeManagementSettings: tradeIndex.settings,
  },
  quality: {
    received: candles.length,
    valid: candles.length,
    invalid: 0,
    filteredOutsideRange: 0,
    duplicates: 0,
    duplicateConflicts: 0,
    outOfOrderDetected: false,
    missingTradableCandles: 0,
    expectedClosedCandles: 0,
    gapCount: 0,
    incompleteByTimeframe: Object.fromEntries(TIMEFRAMES.map((timeframe) => [timeframe, 0])) as Record<Timeframe, number>,
    coverageStatusByTimeframe: coverage,
    issueSamples: [],
    gapSamples: [],
  },
  datasets,
  behaviourSummaries,
  priceBehaviourSummaries,
  marketStateSummary: tradeIndex.signalIndex.marketStateSummary,
  latestMarketState: tradeIndex.signalIndex.latestMarketState,
  hypothesisOpportunitySummary: tradeIndex.signalIndex.hypothesisOpportunitySummary,
  latestHypothesisOpportunity: tradeIndex.signalIndex.latestHypothesisOpportunity,
  signalDecisionSummary: tradeIndex.signalIndex.summary,
  latestSignalDecision: tradeIndex.signalIndex.latest,
  tradeManagementSummary: tradeIndex.summary,
  latestTradePlan: tradeIndex.latest,
  rolling5hLatest: null,
};
const reportSummary = createAnalysisReportSummary(base);
const analysis: CachedAnalysis = { ...base, reportSummary };
const report = createAnalysisReport(analysis);
const window = createMarketWindow(analysis, "M1", 35_000, 5_000, 5_000);
const m5Window = createMarketWindow(
  analysis,
  "M5",
  Math.max(0, datasets.M5.candles.length - 1_000),
  1_000,
  5_000,
);
const reportBytes = new TextEncoder().encode(JSON.stringify(report)).byteLength;

assertEqual(report.analysisId, analysis.id, "analysis id");
assertEqual(report.summary.comparisonMetrics.m1Candles, 40_000, "M1 count");
assertEqual(report.signalEvents.length, tradeIndex.signalIndex.eventSlots.length, "signal event count");
assertEqual(report.tradePlans.length, tradeIndex.plans.length, "trade plan count");
assertCondition(report.summary.keyFindings.length >= 5, "Expected report findings.");
assertCondition(window.signalMarkers.length > 0, "Expected historical signal markers in the final M1 window.");
assertCondition(window.signalMarkers.every((marker) => marker.timestampMs >= window.candles[0][0]), "Marker before window.");
assertCondition(window.signalMarkers.every((marker) => marker.timestampMs <= window.candles.at(-1)![0]), "Marker after window.");
assertCondition(window.signalMarkers.some((marker) => marker.action === "BUY" || marker.action === "SELL"), "Expected BUY or SELL marker.");
const m5Times = new Set(m5Window.candles.map((candle) => candle[0]));
assertCondition(m5Window.signalMarkers.every((marker) => m5Times.has(marker.timestampMs)), "M5 marker was not aligned to a visible M5 candle.");
assertCondition(reportBytes < 8 * 1024 * 1024, "Single complete report exceeds the 8 MB verification guard.");

console.log(JSON.stringify({
  ok: true,
  signalEvents: report.signalEvents.length,
  tradePlans: report.tradePlans.length,
  chartMarkers: window.signalMarkers.length,
  m5ChartMarkers: m5Window.signalMarkers.length,
  reportFindings: report.summary.keyFindings.length,
  reportMb: Math.round((reportBytes / 1024 / 1024) * 100) / 100,
}, null, 2));
