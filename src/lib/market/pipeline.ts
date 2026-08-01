import { fetchFinageM1AggregateResponse } from "@/lib/finage/client";
import { aggregateAllTimeframes, calculateLatestRollingWindow } from "./aggregate";
import { analysisCache } from "./analysis-cache";
import { summarizeCandleBehaviour } from "./behaviour";
import { summarizePriceBehaviour } from "./price-behaviour";
import { createAnalysisReportSummary } from "./report";
import { DEFAULT_TRADE_MANAGEMENT_SETTINGS, getOrCreateTradeManagementIndex } from "./trade-management";
import { planFinageDateChunks } from "./chunk-plan";
import { mapWithConcurrency } from "./concurrency";
import { ALL_TIMEFRAMES } from "./constants";
import { getServerEnv } from "./env";
import { describeDailyBoundary, type WeekendSchedule } from "./market-session";
import { detectGaps } from "./gaps";
import { dedupeSortedCandles, normalizeFinageAggregates } from "./normalize";
import type {
  AnalyzeMarketResponse,
  CandleCompleteness,
  CandleCoverageStatus,
  CompactCandle,
  DataIssue,
  Timeframe,
  TimeframeDataset,
  TimeframeMeta,
} from "./types";
import { createMarketWindow } from "./window";

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
): TimeframeMeta {
  return {
    timeframe,
    candleCount: dataset.candles.length,
    firstTimestampMs: dataset.candles[0]?.[0] ?? null,
    lastTimestampMs: dataset.candles.at(-1)?.[0] ?? null,
    incompleteCandles: countIncomplete(dataset),
  };
}

function createWeekendSchedule(env: ReturnType<typeof getServerEnv>): WeekendSchedule {
  return env.FOREX_WEEKEND_MODE === "NEW_YORK_17"
    ? { mode: "NEW_YORK_17" }
    : {
        mode: "FIXED_UTC",
        fridayCloseUtcHour: env.FOREX_FRIDAY_CLOSE_UTC_HOUR,
        sundayOpenUtcHour: env.FOREX_SUNDAY_OPEN_UTC_HOUR,
      };
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

  const calendarDays = (toTimestampMs - fromTimestampMs) / 86_400_000;
  if (calendarDays > 120) {
    throw new Error("The current release supports a maximum range of 120 calendar days.");
  }

  const chunks = planFinageDateChunks({
    fromTimestampMs,
    toTimestampMs,
    multiplierMinutes: 1,
    targetMaxResults: env.FINAGE_MAX_RESULTS_PER_REQUEST,
  });

  const rawChunks = await mapWithConcurrency(
    chunks,
    env.FINAGE_FETCH_CONCURRENCY,
    async (chunk) => {
      const response = await fetchFinageM1AggregateResponse({
        baseUrl: env.FINAGE_REST_BASE_URL,
        apiKey: env.FINAGE_API_KEY,
        symbol: env.FINAGE_XAUUSD_SYMBOL,
        fromDate: chunk.fromDate,
        toDate: chunk.toDate,
        limit: env.FINAGE_MAX_RESULTS_PER_REQUEST,
        timeoutMs: env.FINAGE_REQUEST_TIMEOUT_MS,
        sort: env.FINAGE_SORT === "provider_default" ? undefined : env.FINAGE_SORT,
        dateFormat:
          env.FINAGE_DATE_FORMAT === "provider_default"
            ? undefined
            : env.FINAGE_DATE_FORMAT,
      });
      if (
        response.totalResults !== undefined &&
        response.totalResults > response.results.length
      ) {
        throw new Error(
          `Finage chunk ${chunk.fromDate}..${chunk.toDate} was truncated: ` +
            `${response.results.length}/${response.totalResults} records received.`,
        );
      }
      return response.results;
    },
  );

  let received = 0;
  let outOfOrderDetected = false;
  let invalidRecords = 0;
  let filteredOutsideRange = 0;
  const normalizedChunks: CompactCandle[][] = [];
  const issues: DataIssue[] = [];

  for (const rawChunk of rawChunks) {
    received += rawChunk.length;
    const normalized = normalizeFinageAggregates(
      rawChunk,
      fromTimestampMs,
      toTimestampMs,
    );
    normalizedChunks.push(normalized.candles);
    invalidRecords += normalized.issues.length;
    filteredOutsideRange += normalized.filteredOutsideRange;
    outOfOrderDetected ||= normalized.outOfOrderDetected;
    if (issues.length < 100) {
      issues.push(...normalized.issues.slice(0, 100 - issues.length));
    }
  }

  const combined: CompactCandle[] = [];
  for (const normalized of normalizedChunks) combined.push(...normalized);

  const deduped = dedupeSortedCandles(combined);
  if (issues.length < 100) {
    issues.push(...deduped.conflictIssues.slice(0, 100 - issues.length));
  }

  if (deduped.candles.length > env.APP_MAX_CANDLES) {
    throw new Error(
      `The selected range returned ${deduped.candles.length.toLocaleString()} candles. ` +
        `Reduce it to ${env.APP_MAX_CANDLES.toLocaleString()} candles or fewer.`,
    );
  }
  if (deduped.candles.length === 0) {
    throw new Error(
      `Finage returned no valid XAUUSD M1 candles for the selected interval. ` +
        `Provider records=${received}, outside exact range=${filteredOutsideRange}, ` +
        `invalid=${invalidRecords}. Run npm run verify:finage with an explicit ` +
        `--from/--to range and confirm your Finage plan includes historical XAUUSD M1 data.`,
    );
  }

  const weekendSchedule = createWeekendSchedule(env);
  const gapResult = detectGaps(deduped.candles, 60_000, weekendSchedule);
  const derived = aggregateAllTimeframes(deduped.candles, {
    requestFromMs: fromTimestampMs,
    requestToMs: toTimestampMs,
    weekendSchedule,
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
  });
  const m1Completeness: CandleCompleteness[] = Array.from(
    { length: deduped.candles.length },
    () => ({
      actualChildren: 1,
      expectedChildren: 1,
      fullIntervalChildren: 1,
      expectedClosedChildren: 0,
      completenessPercent: 100,
      status: "COMPLETE" as const,
    }),
  );

  const datasets: Record<Timeframe, TimeframeDataset> = {
    M1: { candles: deduped.candles, completeness: m1Completeness },
    M5: derived.M5,
    M15: derived.M15,
    H1: derived.H1,
    D1: derived.D1,
  };

  const rolling5hLatest = calculateLatestRollingWindow(deduped.candles, 300);
  const behaviourSummaries = {
    M1: summarizeCandleBehaviour(datasets.M1.candles),
    M5: summarizeCandleBehaviour(datasets.M5.candles),
    M15: summarizeCandleBehaviour(datasets.M15.candles),
    H1: summarizeCandleBehaviour(datasets.H1.candles),
    D1: summarizeCandleBehaviour(datasets.D1.candles),
  };
  const priceBehaviourSummaries = {
    M1: summarizePriceBehaviour(datasets.M1.candles),
    M5: summarizePriceBehaviour(datasets.M5.candles),
    M15: summarizePriceBehaviour(datasets.M15.candles),
    H1: summarizePriceBehaviour(datasets.H1.candles),
    D1: summarizePriceBehaviour(datasets.D1.candles),
  };
  const tradeManagementIndex = getOrCreateTradeManagementIndex(datasets, {
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    settings: tradeManagementSettings,
  });
  const signalDecisionIndex = tradeManagementIndex.signalIndex;
  const marketStateResult = {
    summary: signalDecisionIndex.marketStateSummary,
    latest: signalDecisionIndex.latestMarketState,
  };
  const hypothesisOpportunityResult = {
    summary: signalDecisionIndex.hypothesisOpportunitySummary,
    latest: signalDecisionIndex.latestHypothesisOpportunity,
  };
  const signalDecisionResult = {
    summary: signalDecisionIndex.summary,
    latest: signalDecisionIndex.latest,
  };
  const tradeManagementResult = {
    summary: tradeManagementIndex.summary,
    latest: tradeManagementIndex.latest,
  };

  const incompleteByTimeframe = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [timeframe, countIncomplete(datasets[timeframe])]),
  ) as Record<Timeframe, number>;
  const coverageStatusByTimeframe = Object.fromEntries(
    ALL_TIMEFRAMES.map((timeframe) => [timeframe, countCoverageStatuses(datasets[timeframe])]),
  ) as Record<Timeframe, Record<CandleCoverageStatus, number>>;

  const processingMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const ttlMs = env.ANALYSIS_CACHE_TTL_MINUTES * 60_000;
  const cacheExpiresAtUtc = new Date(Date.now() + ttlMs).toISOString();
  const meta = {
    symbol: env.FINAGE_XAUUSD_SYMBOL,
    source: "FINAGE" as const,
    requestedFromUtc: new Date(fromTimestampMs).toISOString(),
    requestedToUtc: new Date(toTimestampMs).toISOString(),
    intervalSemantics: "[from,to)" as const,
    sourceTimeframe: "M1" as const,
    fetchChunks: chunks.length,
    processingMs,
    cacheExpiresAtUtc,
    weekendScheduleMode: env.FOREX_WEEKEND_MODE,
    dailyBoundaryMode: env.DAILY_BOUNDARY_MODE,
    dailyBoundaryDescription: describeDailyBoundary(env.DAILY_BOUNDARY_MODE),
    maxWindowCandles: env.APP_MAX_WINDOW_CANDLES,
    tradeManagementSettings,
  };
  const quality = {
    received,
    valid: deduped.candles.length,
    invalid: invalidRecords,
    filteredOutsideRange,
    duplicates: deduped.duplicates,
    duplicateConflicts: deduped.duplicateConflicts,
    outOfOrderDetected,
    missingTradableCandles: gapResult.missingTradableCandles,
    expectedClosedCandles: gapResult.expectedClosedCandles,
    gapCount: gapResult.gaps.length,
    incompleteByTimeframe,
    coverageStatusByTimeframe,
    issueSamples: issues.slice(0, 25),
    gapSamples: gapResult.gaps.slice(0, 50),
  };
  const reportSummary = createAnalysisReportSummary({
    meta,
    quality,
    datasets,
    marketStateSummary: marketStateResult.summary,
    latestMarketState: marketStateResult.latest,
    hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
    latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
    signalDecisionSummary: signalDecisionResult.summary,
    latestSignalDecision: signalDecisionResult.latest,
    tradeManagementSummary: tradeManagementResult.summary,
    latestTradePlan: tradeManagementResult.latest,
  });

  const cached = analysisCache.create(
    {
      meta,
      quality,
      datasets,
      behaviourSummaries,
      priceBehaviourSummaries,
      marketStateSummary: marketStateResult.summary,
      latestMarketState: marketStateResult.latest,
      hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
      latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
      signalDecisionSummary: signalDecisionResult.summary,
      latestSignalDecision: signalDecisionResult.latest,
      tradeManagementSummary: tradeManagementResult.summary,
      latestTradePlan: tradeManagementResult.latest,
      reportSummary,
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
      createTimeframeMeta(timeframe, datasets[timeframe]),
    ]),
  ) as Record<Timeframe, TimeframeMeta>;

  const initialTimeframe: Timeframe = datasets.M1.candles.length > 25_000 ? "M15" : "M5";
  const initialLimit = 2_000;
  const initialOffset = Math.max(0, datasets[initialTimeframe].candles.length - initialLimit);

  return {
    analysisId: cached.id,
    meta,
    quality,
    timeframes,
    behaviourSummaries,
    priceBehaviourSummaries,
    marketStateSummary: marketStateResult.summary,
    latestMarketState: marketStateResult.latest,
    hypothesisOpportunitySummary: hypothesisOpportunityResult.summary,
    latestHypothesisOpportunity: hypothesisOpportunityResult.latest,
    signalDecisionSummary: signalDecisionResult.summary,
    latestSignalDecision: signalDecisionResult.latest,
    tradeManagementSummary: tradeManagementResult.summary,
    latestTradePlan: tradeManagementResult.latest,
    reportSummary,
    rolling5hLatest,
    initialWindow: createMarketWindow(
      cached,
      initialTimeframe,
      initialOffset,
      initialLimit,
      env.APP_MAX_WINDOW_CANDLES,
    ),
  };
}
