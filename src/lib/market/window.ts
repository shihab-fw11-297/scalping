import { analyzeCandleBehaviourWindow } from "./behaviour";
import { analyzePriceBehaviourWindow } from "./price-behaviour";
import { getNextDailyBucketStart } from "./market-session";
import {
  analyzeSessionLiquidityAt,
  getOrCreateSessionLiquidityIndex,
} from "./session-liquidity";
import { TIMEFRAME_MS } from "./constants";
import {
  analyzeMultiTimeframeStateAt,
  getOrCreateMultiTimeframeStateIndex,
} from "./multi-timeframe-state";
import {
  analyzeHypothesesAndOpportunitiesAt,
  getOrCreateHypothesisOpportunityIndex,
} from "./hypothesis-opportunity";
import {
  analyzeSignalDecisionAt,
  createSignalMarkersForWindow,
  getOrCreateSignalDecisionIndex,
  signalCandleIndexAtOrBefore,
} from "./signal-decision";
import {
  analyzeTradeManagementAt,
  createTradeReadyMarkersForWindow,
  getOrCreateTradeManagementIndex,
} from "./trade-management";
import type {
  CachedAnalysis,
  CandleBehaviourView,
  ChartSignalMarker,
  MarketWindowResponse,
  Phase12NativeSignal,
  PriceBehaviourView,
  SignalOriginTimeframe,
  SignalWindowNavigation,
  Timeframe,
} from "./types";

function chartIndexAtOrBefore(candles: readonly (readonly [number, number, number, number, number, number])[], timestampMs: number): number {
  let low = 0;
  let high = candles.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] <= timestampMs) {
      answer = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return answer;
}

function shortFamily(family: Phase12NativeSignal["family"]): string {
  if (family === "PRESSURE_RELEASE") return "PR";
  if (family === "FAILED_BREAK_REVERSAL") return "FBR";
  if (family === "IMPULSE_RELOAD") return "IR";
  if (family === "SESSION_LIQUIDITY_QML") return "QML";
  return "TFR";
}

function markerFromPhase12(
  signal: Phase12NativeSignal,
  chartCandles: CachedAnalysis["datasets"][Timeframe]["candles"],
  chartIndex: number,
  research: boolean,
): ChartSignalMarker {
  return {
    timestampMs: chartCandles[chartIndex][0],
    eventTimestampMs: signal.timestampMs,
    family: signal.family,
    direction: signal.direction,
    lifecycle: "CONFIRMED",
    action: signal.action,
    score: signal.score,
    referencePrice: signal.entryPrice,
    label: `${signal.action} ${signal.grade} ${signal.originTimeframe}-${shortFamily(signal.family)} ${Math.round(signal.score)}${research ? ` · ${signal.permission}` : ""}`,
    markerKind: research ? "RESEARCH" : "TRADE_READY",
    grade: signal.grade,
    planStatus: signal.permission === "BLOCKED" ? "REJECTED" : "WAIT_ENTRY",
    originTimeframe: signal.originTimeframe,
    executionTimeframe: signal.executionTimeframe,
    signalSource: signal.source,
    permission: signal.permission,
  };
}

function phase12MarkersAndNavigation(input: {
  analysis: CachedAnalysis;
  timeframe: Timeframe;
  chartCandles: CachedAnalysis["datasets"][Timeframe]["candles"];
  visibleStart: number;
  visibleEnd: number;
  windowOffset: number;
  windowLimit: number;
}): { trade: ChartSignalMarker[]; research: ChartSignalMarker[]; navigation: SignalWindowNavigation } {
  const { analysis, chartCandles, visibleStart, visibleEnd, windowOffset, windowLimit } = input;
  const trade: ChartSignalMarker[] = [];
  const research: ChartSignalMarker[] = [];
  const originCounts: Record<SignalOriginTimeframe, number> = { M1: 0, M5: 0, M15: 0 };
  const navigableIndices: number[] = [];
  const requestedFrom = Date.parse(analysis.meta.requestedFromUtc);
  const requestedTo = Date.parse(analysis.meta.requestedToUtc);
  for (const signal of analysis.phase12.signals) {
    if (signal.timestampMs < requestedFrom || signal.timestampMs >= requestedTo) continue;
    const chartIndex = chartIndexAtOrBefore(chartCandles, signal.timestampMs - 1);
    if (chartIndex < 0) continue;
    const isDefault = (signal.grade === "A" || signal.grade === "B") &&
      (signal.permission === "TRADE_READY" || signal.permission === "PAPER_TRADE");
    if (isDefault) {
      originCounts[signal.originTimeframe] += 1;
      navigableIndices.push(chartIndex);
    }
    if (chartIndex < visibleStart || chartIndex >= visibleEnd) continue;
    const marker = markerFromPhase12(signal, chartCandles, chartIndex, !isDefault);
    if (isDefault) trade.push(marker);
    else research.push(marker);
  }
  navigableIndices.sort((a, b) => a - b);
  const relative = navigableIndices.map((index) => index - visibleStart).filter((index) => index >= 0);
  const windowEnd = windowOffset + windowLimit;
  const inWindow = relative.filter((index) => index >= windowOffset && index < windowEnd);
  const previous = [...relative].reverse().find((index) => index < windowOffset);
  const next = relative.find((index) => index >= windowEnd);
  const offsetFor = (index: number | undefined): number | null => index === undefined
    ? null
    : Math.max(0, Math.min(Math.max(0, input.analysis.visibleRanges[input.timeframe].total - windowLimit), index - Math.floor(windowLimit / 2)));
  return {
    trade: trade.sort((a, b) => a.eventTimestampMs - b.eventTimestampMs),
    research: research.sort((a, b) => a.eventTimestampMs - b.eventTimestampMs),
    navigation: {
      totalSignalsInPeriod: relative.length,
      signalsInWindow: inWindow.length,
      firstSignalOffset: offsetFor(relative[0]),
      previousSignalOffset: offsetFor(previous),
      nextSignalOffset: offsetFor(next),
      lastSignalOffset: offsetFor(relative.at(-1)),
      originCounts,
    },
  };
}


function windowAnchorTimestamp(
  timeframe: Timeframe,
  candleTimestampMs: number,
  dailyBoundaryMode: CachedAnalysis["meta"]["dailyBoundaryMode"],
): number {
  return timeframe === "D1"
    ? getNextDailyBucketStart(candleTimestampMs, dailyBoundaryMode)
    : candleTimestampMs + TIMEFRAME_MS[timeframe];
}

export function createMarketWindow(
  analysis: CachedAnalysis,
  timeframe: Timeframe,
  requestedOffset: number,
  requestedLimit: number,
  maximumLimit = 5_000,
): MarketWindowResponse {
  const dataset = analysis.datasets[timeframe];
  const visibleRange = analysis.visibleRanges?.[timeframe] ?? {
    start: 0,
    end: dataset.candles.length,
    total: dataset.candles.length,
  };
  const total = visibleRange.total;
  const limit = Math.max(1, Math.min(maximumLimit, Math.floor(requestedLimit)));
  const maximumOffset = Math.max(0, total - limit);
  const offset = Math.max(0, Math.min(maximumOffset, Math.floor(requestedOffset)));
  const end = Math.min(total, offset + limit);
  const absoluteOffset = visibleRange.start + offset;
  const absoluteEnd = visibleRange.start + end;
  const detailed = analyzeCandleBehaviourWindow(dataset.candles, absoluteOffset, absoluteEnd - absoluteOffset);
  const priceDetailed = analyzePriceBehaviourWindow(dataset.candles, absoluteOffset, absoluteEnd - absoluteOffset);

  const behaviours: CandleBehaviourView[] = detailed.map((item) => ({
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

  const priceBehaviours: PriceBehaviourView[] = priceDetailed.map((item) => ({
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

  const lastCandle = dataset.candles[absoluteEnd - 1];
  const marketStateAtWindowEnd = lastCandle
    ? analyzeMultiTimeframeStateAt(
        getOrCreateMultiTimeframeStateIndex(analysis.datasets, {
          dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
        }),
        windowAnchorTimestamp(timeframe, lastCandle[0], analysis.meta.dailyBoundaryMode),
      )
    : null;
  const hypothesisOpportunityAtWindowEnd = lastCandle
    ? analyzeHypothesesAndOpportunitiesAt(
        getOrCreateHypothesisOpportunityIndex(analysis.datasets, {
          dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
        }),
        windowAnchorTimestamp(timeframe, lastCandle[0], analysis.meta.dailyBoundaryMode),
      )
    : null;
  const signalIndex = getOrCreateSignalDecisionIndex(analysis.datasets, {
    dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
  });
  const researchSignalMarkers = createSignalMarkersForWindow(
    signalIndex,
    timeframe,
    dataset.candles,
    absoluteOffset,
    absoluteEnd,
    analysis.meta.dailyBoundaryMode,
  );
  const signalDecisionAtWindowEnd = lastCandle
    ? analyzeSignalDecisionAt(
        signalIndex,
        windowAnchorTimestamp(timeframe, lastCandle[0], analysis.meta.dailyBoundaryMode),
      )
    : null;
  const tradeIndex = getOrCreateTradeManagementIndex(analysis.datasets, {
    dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    settings: analysis.meta.tradeManagementSettings,
  });
  // Build the legacy marker path as a regression oracle, then use the Phase 12
  // native M1/M5/M15 catalogue for the user-visible marker set.
  createTradeReadyMarkersForWindow(
    tradeIndex,
    timeframe,
    dataset.candles,
    absoluteOffset,
    absoluteEnd,
    analysis.meta.dailyBoundaryMode,
  );
  const phase12Window = phase12MarkersAndNavigation({
    analysis,
    timeframe,
    chartCandles: dataset.candles,
    visibleStart: visibleRange.start,
    visibleEnd: visibleRange.end,
    windowOffset: offset,
    windowLimit: limit,
  });
  const signalMarkers = phase12Window.trade.filter((marker) => {
    const chartIndex = chartIndexAtOrBefore(dataset.candles, marker.timestampMs);
    return chartIndex >= absoluteOffset && chartIndex < absoluteEnd;
  });
  const phase12ResearchMarkers = phase12Window.research.filter((marker) => {
    const chartIndex = chartIndexAtOrBefore(dataset.candles, marker.timestampMs);
    return chartIndex >= absoluteOffset && chartIndex < absoluteEnd;
  });

  const sessionLiquidityAtWindowEnd = lastCandle
    ? analyzeSessionLiquidityAt(
        getOrCreateSessionLiquidityIndex(analysis.datasets, analysis.meta.dailyBoundaryMode),
        windowAnchorTimestamp(timeframe, lastCandle[0], analysis.meta.dailyBoundaryMode),
      )
    : null;
  const tradePlanAtWindowEnd = lastCandle
    ? analyzeTradeManagementAt(
        tradeIndex,
        windowAnchorTimestamp(timeframe, lastCandle[0], analysis.meta.dailyBoundaryMode),
      )
    : null;

  return {
    analysisId: analysis.id,
    recoveredFromSource: false,
    timeframe,
    offset,
    limit,
    total,
    candles: dataset.candles.slice(absoluteOffset, absoluteEnd),
    completeness: dataset.completeness.slice(absoluteOffset, absoluteEnd),
    behaviours,
    priceBehaviours,
    signalMarkers,
    researchSignalMarkers: [...researchSignalMarkers, ...phase12ResearchMarkers]
      .sort((left, right) => left.eventTimestampMs - right.eventTimestampMs),
    signalNavigation: phase12Window.navigation,
    marketStateAtWindowEnd,
    hypothesisOpportunityAtWindowEnd,
    signalDecisionAtWindowEnd,
    tradePlanAtWindowEnd,
    sessionLiquidityAtWindowEnd,
  };
}
