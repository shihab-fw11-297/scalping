import { aggregateAllTimeframes, calculateLatestRollingWindow } from "./aggregate";
import { createVisibleRanges, sliceVisibleDataset } from "./analysis-range";
import { analysisCache } from "./analysis-cache";
import { summarizeCandleBehaviour } from "./behaviour";
import { cleanMarketCandles, createM1CompletenessWithGapSafety } from "./data-cleaning";
import { summarizePriceBehaviour } from "./price-behaviour";
import { createAnalysisReport, createAnalysisReportSummary } from "./report";
import {
  analyzeSessionLiquidityAt,
  summarizeSessionLiquidityRange,
} from "./session-liquidity";
import {
  DEFAULT_TRADE_MANAGEMENT_SETTINGS,
  analyzeTradeManagementAt,
  createTradePlanHistory,
  getOrCreateTradeManagementIndex,
  summarizeTradeManagementRange,
} from "./trade-management";
import { planFinageDateChunks } from "./chunk-plan";
import { mapWithConcurrency } from "./concurrency";
import { fetchFinageChunkAdaptive } from "./finage-chunk-fetch";
import { ALL_TIMEFRAMES } from "./constants";
import { getServerEnv } from "./env";
import { STATIC_RUNTIME_LIMITS } from "./static-limits";
import {
  countExpectedMarketMinutes,
  describeDailyBoundary,
  type WeekendSchedule,
} from "./market-session";
import {
  analyzeMultiTimeframeStateAt,
  summarizeMultiTimeframeStates,
} from "./multi-timeframe-state";
import {
  analyzeHypothesesAndOpportunitiesAt,
  summarizeHypothesesAndOpportunities,
} from "./hypothesis-opportunity";
import {
  analyzeSignalDecisionAt,
  asHypothesisOpportunityIndex,
  summarizeSignalDecisionRange,
} from "./signal-decision";
import { detectGaps } from "./gaps";
import { mergeAndDedupeCandleChunks, normalizeFinageAggregates } from "./normalize";
import type {
  AnalyzeMarketResponse,
  AnalysisRecoveryRequest,
  CandleCompleteness,
  CandleCoverageStatus,
  CompactCandle,
  DataIssue,
  Timeframe,
  TimeframeDataset,
  TimeframeMeta,
  VisibleDatasetRange,
} from "./types";
import { createMarketWindow } from "./window";
import { createPhase12MultiTimeframeReport } from "./phase12-multi-timeframe";

export interface AnalyzeRequest {
  fromUtc: string;
  toUtc: string;
  assumedSpreadPrice?: number;
  assumedSlippagePrice?: number;
  minimumRiskReward?: number;
  maximumRiskInAverageRanges?: number;
}

function isCoverageFailure(status: CandleCoverageStatus): boolean {
  return status === "MISSING_DATA" || status === "PARTIAL_MISSING_DATA" || status === "OVERFULL";
}

function countIncomplete(dataset: TimeframeDataset): number {
  let incomplete = 0;
  for (const item of dataset.completeness) {
    if (isCoverageFailure(item.status)) incomplete += 1;
  }
  return incomplete;
}

function countCoverageStatuses(
  dataset: TimeframeDataset,
): Record<CandleCoverageStatus, number> {
  const counts: Record<CandleCoverageStatus, number> = {
    COMPLETE: 0,
    PARTIAL_REQUEST_BOUNDARY: 0,
    EXPECTED_MARKET_CLOSURE: 0,
    BOUNDARY_AND_CLOSURE: 0,
    MISSING_DATA: 0,
    PARTIAL_MISSING_DATA: 0,
    OVERFULL: 0,
  };
  for (const item of dataset.completeness) counts[item.status] += 1;
  return counts;
}

function createTimeframeMeta(
  timeframe: Timeframe,
  dataset: TimeframeDataset,
  visibleRange?: VisibleDatasetRange,
): TimeframeMeta {
  const start = visibleRange?.start ?? 0;
  const end = visibleRange?.end ?? dataset.candles.length;
  const visibleDataset: TimeframeDataset = {
    candles: dataset.candles.slice(start, end),
    completeness: dataset.completeness.slice(start, end),
  };
  return {
    timeframe,
    candleCount: visibleDataset.candles.length,
    firstTimestampMs: visibleDataset.candles[0]?.[0] ?? null,
    lastTimestampMs: visibleDataset.candles.at(-1)?.[0] ?? null,
    incompleteCandles: countIncomplete(visibleDataset),
  };
}

function resolveWarmupCalendarDays(
  requestedDays: number,
  configuredDays: number,
  maximumCandles: number,
): number {
  const estimatedSelectedTradableCandles = requestedDays * 1_440 * (5 / 7);
  const remainingCapacity = Math.max(0, maximumCandles - estimatedSelectedTradableCandles);
  const capacityDays = Math.max(0, Math.floor(remainingCapacity / (1_440 * (5 / 7))));
  return Math.min(configuredDays, capacityDays);
}

function createWeekendSchedule(env: ReturnType<typeof getServerEnv>): WeekendSchedule {
  return env.FOREX_WEEKEND_MODE === "NEW_YORK_17"
    ? {
        mode: "NEW_YORK_17",
        // Finage can emit sparse XAUUSD placeholders during the daily gold
        // maintenance break. Remove them as expected closed-market records.
        dailyMaintenance: "NEW_YORK_17_TO_18",
      }
    : {
        mode: "FIXED_UTC",
        fridayCloseUtcHour: env.FOREX_FRIDAY_CLOSE_UTC_HOUR,
        sundayOpenUtcHour: env.FOREX_SUNDAY_OPEN_UTC_HOUR,
      };
}

function assertMinimumM1Coverage(
  label: string,
  actualCandles: number,
  expectedTradableCandles: number,
): number {
  const coveragePercent = expectedTradableCandles === 0
    ? 100
    : (actualCandles / expectedTradableCandles) * 100;
  if (
    coveragePercent <
    STATIC_RUNTIME_LIMITS.MINIMUM_ANALYSIS_M1_COVERAGE_PERCENT
  ) {
    const missing = Math.max(0, expectedTradableCandles - actualCandles);
    throw new Error(
      `Analysis blocked: ${label} Finage M1 coverage is ${coveragePercent.toFixed(2)}% ` +
        `(${actualCandles.toLocaleString()}/${expectedTradableCandles.toLocaleString()} ` +
        `tradable minutes; ${missing.toLocaleString()} missing). ` +
        `At least ${STATIC_RUNTIME_LIMITS.MINIMUM_ANALYSIS_M1_COVERAGE_PERCENT}% is required ` +
        `for a meaningful backtest or optimisation.`,
    );
  }
  return coveragePercent;
}

export async function analyzeHistoricalMarket(
  request: AnalyzeRequest,
): Promise<AnalyzeMarketResponse> {
  const startedAt = performance.now();
  const env = getServerEnv();
  const tradeManagementSettings = {
    assumedSpreadPrice: Math.max(0, request.assumedSpreadPrice ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.assumedSpreadPrice),
    assumedSlippagePrice: Math.max(0, request.assumedSlippagePrice ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.assumedSlippagePrice),
    minimumRiskReward: Math.max(1, request.minimumRiskReward ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.minimumRiskReward),
    maximumRiskInAverageRanges: Math.max(0.5, request.maximumRiskInAverageRanges ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.maximumRiskInAverageRanges),
  };
  const fromTimestampMs = Date.parse(request.fromUtc);
  const toTimestampMs = Date.parse(request.toUtc);

  if (!Number.isFinite(fromTimestampMs) || !Number.isFinite(toTimestampMs)) {
    throw new Error("Invalid from/to datetime.");
  }
  if (toTimestampMs <= fromTimestampMs) {
    throw new Error("The end datetime must be later than the start datetime.");
  }
  const latestClosedMinuteMs = Math.floor(Date.now() / 60_000) * 60_000;
  if (toTimestampMs > latestClosedMinuteMs) {
    throw new Error("Historical analysis end time cannot be in the future or inside the current incomplete minute.");
  }

  const calendarDays = (toTimestampMs - fromTimestampMs) / 86_400_000;
  if (calendarDays > 120) {
    throw new Error("The current release supports a maximum range of 120 calendar days.");
  }

  const warmupCalendarDays = resolveWarmupCalendarDays(
    calendarDays,
    env.ANALYSIS_WARMUP_CALENDAR_DAYS,
    STATIC_RUNTIME_LIMITS.APP_MAX_CANDLES,
  );
  const contextFromTimestampMs = fromTimestampMs - warmupCalendarDays * 86_400_000;

  const plannedChunks = planFinageDateChunks({
    fromTimestampMs: contextFromTimestampMs,
    toTimestampMs,
    multiplierMinutes: 1,
    targetMaxResults: STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST,
    maximumCalendarDaysPerChunk:
      STATIC_RUNTIME_LIMITS.FINAGE_M1_CHUNK_CALENDAR_DAYS,
  });

  console.info("[Finage API] M1 chunk plan", {
    fromDate: plannedChunks[0]?.fromDate ?? null,
    toDate: plannedChunks.at(-1)?.toDate ?? null,
    plannedChunks: plannedChunks.length,
    maximumCalendarDaysPerChunk:
      STATIC_RUNTIME_LIMITS.FINAGE_M1_CHUNK_CALENDAR_DAYS,
    limitPerRequest: STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST,
    concurrency: STATIC_RUNTIME_LIMITS.FINAGE_FETCH_CONCURRENCY,
  });

  const adaptiveFetches = await mapWithConcurrency(
    plannedChunks,
    STATIC_RUNTIME_LIMITS.FINAGE_FETCH_CONCURRENCY,
    async (chunk) =>
      fetchFinageChunkAdaptive({
        chunk,
        minimumCalendarDays:
          STATIC_RUNTIME_LIMITS.FINAGE_M1_MIN_CHUNK_CALENDAR_DAYS,
        maximumSplitDepth: STATIC_RUNTIME_LIMITS.FINAGE_M1_MAX_SPLIT_DEPTH,
        baseUrl: env.FINAGE_REST_BASE_URL,
        apiKey: env.FINAGE_API_KEY,
        symbol: env.FINAGE_XAUUSD_SYMBOL,
        limit: STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST,
        timeoutMs: env.FINAGE_REQUEST_TIMEOUT_MS,
        sort: env.FINAGE_SORT === "provider_default" ? undefined : env.FINAGE_SORT,
        dateFormat:
          env.FINAGE_DATE_FORMAT === "provider_default"
            ? undefined
            : env.FINAGE_DATE_FORMAT,
      }),
  );

  const fetchedChunks = adaptiveFetches.flatMap((fetchResult) => fetchResult.leaves);
  const adaptiveSplitCount = adaptiveFetches.reduce(
    (sum, fetchResult) => sum + fetchResult.splitCount,
    0,
  );
  if (adaptiveSplitCount > 0) {
    console.warn("[Finage API] Adaptive M1 chunk recovery applied", {
      plannedChunks: plannedChunks.length,
      completedChunks: fetchedChunks.length,
      adaptiveSplitCount,
    });
  }

  let received = 0;
  let outOfOrderDetected = false;
  let invalidRecords = 0;
  let filteredOutsideRange = 0;
  const normalizedChunks: CompactCandle[][] = [];
  const issues: DataIssue[] = [];

  for (const fetchedChunk of fetchedChunks) {
    const rawChunk = fetchedChunk.results;
    received += rawChunk.length;
    const chunkFromTimestampMs = Date.parse(
      `${fetchedChunk.chunk.fromDate}T00:00:00.000Z`,
    );
    const chunkToTimestampMs =
      Date.parse(`${fetchedChunk.chunk.toDate}T00:00:00.000Z`) + 86_400_000;
    const normalized = normalizeFinageAggregates(
      rawChunk,
      Math.max(contextFromTimestampMs, chunkFromTimestampMs),
      Math.min(toTimestampMs, chunkToTimestampMs),
    );
    normalizedChunks.push(normalized.candles);
    invalidRecords += normalized.issues.length;
    filteredOutsideRange += normalized.filteredOutsideRange;
    outOfOrderDetected ||= normalized.outOfOrderDetected;
    if (issues.length < 100) {
      issues.push(...normalized.issues.slice(0, 100 - issues.length));
    }
  }

  // Keep the adjacent deduper correct even if a retry path or future chunk
  // executor returns individually sorted leaves in a different order.
  const deduped = mergeAndDedupeCandleChunks(normalizedChunks);
  outOfOrderDetected ||= deduped.outOfOrderDetected;
  if (issues.length < 100) {
    issues.push(...deduped.conflictIssues.slice(0, 100 - issues.length));
  }

  const weekendSchedule = createWeekendSchedule(env);
  const cleaned = cleanMarketCandles(deduped.candles, weekendSchedule);
  if (issues.length < 100) issues.push(...cleaned.issues.slice(0, 100 - issues.length));

  if (cleaned.candles.length > STATIC_RUNTIME_LIMITS.APP_MAX_CANDLES) {
    throw new Error(
      `The selected range plus automatic warm-up returned ${cleaned.candles.length.toLocaleString()} candles. ` +
        `Reduce it to ${STATIC_RUNTIME_LIMITS.APP_MAX_CANDLES.toLocaleString()} candles or fewer.`,
    );
  }
  if (cleaned.candles.length === 0) {
    throw new Error(
      `Finage returned no valid XAUUSD M1 candles for the selected interval. ` +
        `Provider records=${received}, outside exact range=${filteredOutsideRange}, ` +
        `invalid=${invalidRecords}. Run npm run verify:finage with an explicit ` +
        `--from/--to range and confirm your Finage plan includes historical XAUUSD M1 data.`,
    );
  }

  const contextExpectedMinutes = countExpectedMarketMinutes(
    contextFromTimestampMs,
    toTimestampMs,
    weekendSchedule,
  );
  assertMinimumM1Coverage(
    "analysis context",
    cleaned.candles.length,
    contextExpectedMinutes.tradable,
  );

  const gapResult = detectGaps(cleaned.candles, 60_000, weekendSchedule);
  const m1CompletenessResult = createM1CompletenessWithGapSafety(
    cleaned.candles,
    gapResult.gaps,
  );
  const derived = aggregateAllTimeframes(cleaned.candles, {
    requestFromMs: contextFromTimestampMs,
    requestToMs: toTimestampMs,
    weekendSchedule,
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    m1Completeness: m1CompletenessResult.completeness,
  });

  const datasets: Record<Timeframe, TimeframeDataset> = {
    M1: { candles: cleaned.candles, completeness: m1CompletenessResult.completeness },
    M5: derived.M5,
    M15: derived.M15,
    H1: derived.H1,
    D1: derived.D1,
  };

  const visibleRanges = createVisibleRanges(datasets, fromTimestampMs, toTimestampMs);
  const selectedDatasets = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [
      timeframe,
      sliceVisibleDataset(datasets[timeframe], visibleRanges[timeframe]),
    ]),
  ) as Record<Timeframe, TimeframeDataset>;

  const selectedExpectedMinutes = countExpectedMarketMinutes(
    fromTimestampMs,
    toTimestampMs,
    weekendSchedule,
  );
  const visibleM1Candles = selectedDatasets.M1.candles.length;
  assertMinimumM1Coverage(
    "selected range",
    visibleM1Candles,
    selectedExpectedMinutes.tradable,
  );

  const rolling5hLatest = calculateLatestRollingWindow(cleaned.candles, 300);
  const behaviourSummaries = {
    M1: summarizeCandleBehaviour(selectedDatasets.M1.candles),
    M5: summarizeCandleBehaviour(selectedDatasets.M5.candles),
    M15: summarizeCandleBehaviour(selectedDatasets.M15.candles),
    H1: summarizeCandleBehaviour(selectedDatasets.H1.candles),
    D1: summarizeCandleBehaviour(selectedDatasets.D1.candles),
  };
  const priceBehaviourSummaries = {
    M1: summarizePriceBehaviour(selectedDatasets.M1.candles),
    M5: summarizePriceBehaviour(selectedDatasets.M5.candles),
    M15: summarizePriceBehaviour(selectedDatasets.M15.candles),
    H1: summarizePriceBehaviour(selectedDatasets.H1.candles),
    D1: summarizePriceBehaviour(selectedDatasets.D1.candles),
  };
  const tradeManagementIndex = getOrCreateTradeManagementIndex(datasets, {
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    settings: tradeManagementSettings,
  });
  const signalDecisionIndex = tradeManagementIndex.signalIndex;
  const sessionLiquidityResult = {
    summary: summarizeSessionLiquidityRange(
      signalDecisionIndex.sessionLiquidityIndex,
      fromTimestampMs,
      toTimestampMs,
    ),
    latest: analyzeSessionLiquidityAt(signalDecisionIndex.sessionLiquidityIndex, toTimestampMs),
  };
  const rangedMarketState = summarizeMultiTimeframeStates(
    signalDecisionIndex.stateIndex,
    undefined,
    fromTimestampMs,
    toTimestampMs,
  );
  const rangedHypothesis = summarizeHypothesesAndOpportunities(
    asHypothesisOpportunityIndex(signalDecisionIndex),
    undefined,
    fromTimestampMs,
    toTimestampMs,
  );
  const marketStateResult = {
    summary: rangedMarketState.summary,
    latest: analyzeMultiTimeframeStateAt(signalDecisionIndex.stateIndex, toTimestampMs),
  };
  const hypothesisOpportunityResult = {
    summary: rangedHypothesis.summary,
    latest: analyzeHypothesesAndOpportunitiesAt(
      asHypothesisOpportunityIndex(signalDecisionIndex),
      toTimestampMs,
    ),
  };
  const signalDecisionResult = {
    summary: summarizeSignalDecisionRange(signalDecisionIndex, fromTimestampMs, toTimestampMs),
    latest: analyzeSignalDecisionAt(signalDecisionIndex, toTimestampMs),
  };
  const tradeManagementResult = {
    summary: summarizeTradeManagementRange(tradeManagementIndex, fromTimestampMs, toTimestampMs),
    latest: analyzeTradeManagementAt(tradeManagementIndex, toTimestampMs),
  };

  const incompleteByTimeframe = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [timeframe, countIncomplete(selectedDatasets[timeframe])]),
  ) as Record<Timeframe, number>;
  const coverageStatusByTimeframe = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [timeframe, countCoverageStatuses(selectedDatasets[timeframe])]),
  ) as Record<Timeframe, Record<CandleCoverageStatus, number>>;

  const selectedGaps = gapResult.gaps.filter(
    (gap) => gap.toTimestampMs >= fromTimestampMs && gap.fromTimestampMs < toTimestampMs,
  );
  const selectedMissingTradable = Math.max(
    0,
    selectedExpectedMinutes.tradable - visibleM1Candles,
  );
  const selectedExpectedClosed = selectedExpectedMinutes.closed;

  const processingMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const ttlMs = env.ANALYSIS_CACHE_TTL_MINUTES * 60_000;
  const cacheExpiresAtUtc = new Date(Date.now() + ttlMs).toISOString();
  const meta = {
    symbol: env.FINAGE_XAUUSD_SYMBOL,
    source: "FINAGE" as const,
    requestedFromUtc: new Date(fromTimestampMs).toISOString(),
    requestedToUtc: new Date(toTimestampMs).toISOString(),
    contextFromUtc: new Date(contextFromTimestampMs).toISOString(),
    warmupCalendarDays,
    warmupCandleCount: visibleRanges.M1.start,
    analysisProfile: "SESSION_LIQUIDITY_QML_V1" as const,
    intervalSemantics: "[from,to)" as const,
    sourceTimeframe: "M1" as const,
    fetchChunks: fetchedChunks.length,
    plannedFetchChunks: plannedChunks.length,
    adaptiveSplitCount,
    processingMs,
    cacheExpiresAtUtc,
    weekendScheduleMode: env.FOREX_WEEKEND_MODE,
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    dailyBoundaryDescription: describeDailyBoundary(env.DAILY_BOUNDARY_MODE),
    maxWindowCandles: STATIC_RUNTIME_LIMITS.APP_MAX_WINDOW_CANDLES,
    tradeManagementSettings,
  };
  const quality = {
    received,
    valid: visibleRanges.M1.total,
    contextValid: cleaned.candles.length,
    warmupCandles: visibleRanges.M1.start,
    invalid: invalidRecords,
    filteredOutsideRange,
    duplicates: deduped.duplicates,
    duplicateConflicts: deduped.duplicateConflicts,
    outOfOrderDetected,
    closedMarketCandlesRemoved: cleaned.closedMarketCandlesRemoved,
    staleCandlesRemoved: cleaned.staleCandlesRemoved,
    gapSafetyCandlesMarked: m1CompletenessResult.markedSafetyCandles,
    missingTradableCandles: selectedMissingTradable,
    expectedClosedCandles: selectedExpectedClosed,
    gapCount: selectedGaps.length,
    incompleteByTimeframe,
    coverageStatusByTimeframe,
    issueSamples: issues.slice(0, 25),
    gapSamples: selectedGaps.slice(0, 50),
  };
  const phase12TradeHistory = createTradePlanHistory(
    tradeManagementIndex,
    "phase12-pending",
    0,
    Math.max(1, tradeManagementIndex.plans.length),
    Math.max(1, tradeManagementIndex.plans.length),
    fromTimestampMs,
    toTimestampMs,
  );
  const phase12 = createPhase12MultiTimeframeReport({
    datasets,
    visibleRanges,
    quality,
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    legacyM1Plans: phase12TradeHistory.items,
  });

  const reportSummary = createAnalysisReportSummary({
    meta,
    quality,
    datasets,
    visibleRanges,
    marketStateSummary: marketStateResult.summary,
    sessionLiquiditySummary: sessionLiquidityResult.summary,
    latestSessionLiquidity: sessionLiquidityResult.latest,
    latestMarketState: marketStateResult.latest,
    hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
    latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
    signalDecisionSummary: signalDecisionResult.summary,
    latestSignalDecision: signalDecisionResult.latest,
    tradeManagementSummary: tradeManagementResult.summary,
    latestTradePlan: tradeManagementResult.latest,
  });
  reportSummary.comparisonMetrics.nativeM1Signals = phase12.timeframeSummaries.M1.generated;
  reportSummary.comparisonMetrics.nativeM5Signals = phase12.timeframeSummaries.M5.generated;
  reportSummary.comparisonMetrics.nativeM15Signals = phase12.timeframeSummaries.M15.generated;
  reportSummary.comparisonMetrics.phase12PaperSignals = phase12.totalTradeReady;
  reportSummary.keyFindings.push(
    `Phase 12 generated ${phase12.timeframeSummaries.M1.generated} M1-origin, ${phase12.timeframeSummaries.M5.generated} native M5 and ${phase12.timeframeSummaries.M15.generated} native M15 signals.`,
  );

  const cached = analysisCache.create(
    {
      meta,
      quality,
      datasets,
      visibleRanges,
      behaviourSummaries,
      priceBehaviourSummaries,
      marketStateSummary: marketStateResult.summary,
      sessionLiquiditySummary: sessionLiquidityResult.summary,
      latestSessionLiquidity: sessionLiquidityResult.latest,
      latestMarketState: marketStateResult.latest,
      hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
      latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
      signalDecisionSummary: signalDecisionResult.summary,
      latestSignalDecision: signalDecisionResult.latest,
      tradeManagementSummary: tradeManagementResult.summary,
      latestTradePlan: tradeManagementResult.latest,
      reportSummary,
      phase12,
      rolling5hLatest,
    },
    {
      ttlMs,
      maxEntries: env.ANALYSIS_CACHE_MAX_ENTRIES,
      maxTotalCandles: env.ANALYSIS_CACHE_MAX_TOTAL_CANDLES,
    },
  );

  const timeframes = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [
      timeframe,
      createTimeframeMeta(timeframe, datasets[timeframe], visibleRanges[timeframe]),
    ]),
  ) as Record<Timeframe, TimeframeMeta>;

  const initialTimeframe: Timeframe = visibleRanges.M1.total > 25_000 ? "M15" : "M5";
  const initialLimit = 2_000;
  const initialOffset = Math.max(0, visibleRanges[initialTimeframe].total - initialLimit);
  const recoveryRequest: AnalysisRecoveryRequest = {
    fromUtc: meta.requestedFromUtc,
    toUtc: meta.requestedToUtc,
    assumedSpreadPrice: tradeManagementSettings.assumedSpreadPrice,
    assumedSlippagePrice: tradeManagementSettings.assumedSlippagePrice,
    minimumRiskReward: tradeManagementSettings.minimumRiskReward,
    maximumRiskInAverageRanges: tradeManagementSettings.maximumRiskInAverageRanges,
  };
  const completeReport = createAnalysisReport(cached);

  return {
    analysisId: cached.id,
    recoveryRequest,
    meta,
    quality,
    timeframes,
    behaviourSummaries,
    priceBehaviourSummaries,
    marketStateSummary: marketStateResult.summary,
    sessionLiquiditySummary: sessionLiquidityResult.summary,
    latestSessionLiquidity: sessionLiquidityResult.latest,
    latestMarketState: marketStateResult.latest,
    hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
    latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
    signalDecisionSummary: signalDecisionResult.summary,
    latestSignalDecision: signalDecisionResult.latest,
    tradeManagementSummary: tradeManagementResult.summary,
    latestTradePlan: tradeManagementResult.latest,
    reportSummary,
    completeReport,
    phase12,
    rolling5hLatest,
    initialWindow: createMarketWindow(
      cached,
      initialTimeframe,
      initialOffset,
      initialLimit,
      STATIC_RUNTIME_LIMITS.APP_MAX_WINDOW_CANDLES,
    ),
  };
}
