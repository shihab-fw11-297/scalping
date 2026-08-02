import { analyzeCandleBehaviourWindow } from "./behaviour";
import { analyzePriceBehaviourWindow } from "./price-behaviour";
import { getNextDailyBucketStart } from "./market-session";
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
} from "./signal-decision";
import {
  analyzeTradeManagementAt,
  createTradeReadyMarkersForWindow,
  getOrCreateTradeManagementIndex,
} from "./trade-management";
import type {
  CachedAnalysis,
  CandleBehaviourView,
  MarketWindowResponse,
  PriceBehaviourView,
  Timeframe,
} from "./types";


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
  const signalMarkers = createTradeReadyMarkersForWindow(
    tradeIndex,
    timeframe,
    dataset.candles,
    absoluteOffset,
    absoluteEnd,
    analysis.meta.dailyBoundaryMode,
  );
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
    researchSignalMarkers,
    marketStateAtWindowEnd,
    hypothesisOpportunityAtWindowEnd,
    signalDecisionAtWindowEnd,
    tradePlanAtWindowEnd,
  };
}
