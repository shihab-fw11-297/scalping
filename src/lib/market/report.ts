import { HYPOTHESIS_OPPORTUNITY_CONFIG } from "./hypothesis-opportunity";
import { MULTI_TIMEFRAME_STATE_CONFIG } from "./multi-timeframe-state";
import { PRICE_BEHAVIOUR_CONFIG } from "./price-behaviour";
import {
  createSignalDecisionHistory,
  getOrCreateSignalDecisionIndex,
  SIGNAL_DECISION_CONFIG,
} from "./signal-decision";
import {
  createTradePlanHistory,
  getOrCreateTradeManagementIndex,
  TRADE_MANAGEMENT_CONFIG,
} from "./trade-management";
import type {
  AnalysisReport,
  AnalysisReportFamilyBreakdown,
  AnalysisReportSummary,
  CachedAnalysis,
  OpportunityFamily,
  SignalDecisionHistoryItem,
  TradePlanHistoryItem,
} from "./types";

const REPORT_VERSION = "1.0" as const;
const FAMILIES: readonly OpportunityFamily[] = [
  "PRESSURE_RELEASE",
  "FAILED_BREAK_REVERSAL",
  "IMPULSE_RELOAD",
  "TIMEFRAME_ROTATION",
];

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function topCounts<T extends string>(record: Record<T, number>, limit = 5): Array<{ code: T; count: number }> {
  return (Object.entries(record) as Array<[T, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

export function createAnalysisReportSummary(
  analysis: Pick<
    CachedAnalysis,
    | "meta"
    | "quality"
    | "datasets"
    | "marketStateSummary"
    | "latestMarketState"
    | "hypothesisOpportunitySummary"
    | "latestHypothesisOpportunity"
    | "signalDecisionSummary"
    | "latestSignalDecision"
    | "tradeManagementSummary"
    | "latestTradePlan"
  >,
): AnalysisReportSummary {
  const signals = analysis.signalDecisionSummary;
  const trades = analysis.tradeManagementSummary;
  const qualityFlags: string[] = [];
  if (analysis.quality.invalid > 0) qualityFlags.push("INVALID_PROVIDER_RECORDS");
  if (analysis.quality.duplicateConflicts > 0) qualityFlags.push("CONFLICTING_DUPLICATES");
  if (analysis.quality.missingTradableCandles > 0) qualityFlags.push("MISSING_TRADABLE_CANDLES");
  if (analysis.quality.incompleteByTimeframe.M1 > 0) qualityFlags.push("INCOMPLETE_M1_CANDLES");
  if (qualityFlags.length === 0) qualityFlags.push("NO_CRITICAL_DATA_QUALITY_FLAG");

  const qualificationRate = percentage(trades.qualifiedPlanCount, trades.createdPlanCount);
  const entryFillRate = percentage(trades.enteredPlanCount, trades.qualifiedPlanCount);
  const tp1ProgressRate = percentage(trades.tp1HitCount, trades.enteredPlanCount);
  const completionRate = percentage(trades.completedPlanCount, trades.enteredPlanCount);
  const ambiguityRate = percentage(trades.ambiguousPlanCount, trades.createdPlanCount);
  const invalidationPerDecision = percentage(
    signals.invalidationCount,
    signals.confirmedSignalCount + signals.continuationSignalCount,
  );

  const diagnosticFlags: string[] = [];
  if (signals.confirmedSignalCount + signals.continuationSignalCount === 0) {
    diagnosticFlags.push("NO_DIRECTIONAL_DECISIONS");
  }
  if (signals.invalidationCount > (signals.confirmedSignalCount + signals.continuationSignalCount) * 2) {
    diagnosticFlags.push("HIGH_INVALIDATION_TO_DECISION_RATIO");
  }
  if (trades.createdPlanCount > 0 && qualificationRate < 30) {
    diagnosticFlags.push("LOW_PLAN_QUALIFICATION_RATE");
  }
  if (trades.qualifiedPlanCount > 0 && entryFillRate < 20) {
    diagnosticFlags.push("LOW_ENTRY_FILL_RATE");
  }
  if (trades.createdPlanCount > 0 && ambiguityRate > 20) {
    diagnosticFlags.push("HIGH_INTRABAR_AMBIGUITY_RATE");
  }
  if (trades.enteredPlanCount > 0 && tp1ProgressRate < 25) {
    diagnosticFlags.push("LOW_TP1_PROGRESS_RATE");
  }
  if (diagnosticFlags.length === 0) diagnosticFlags.push("NO_AUTOMATIC_DIAGNOSTIC_FLAG");

  const keyFindings = [
    `${analysis.datasets.M1.candles.length.toLocaleString()} valid M1 candles were analysed with ${analysis.quality.missingTradableCandles.toLocaleString()} missing tradable candles detected.`,
    `${signals.confirmedSignalCount.toLocaleString()} confirmed and ${signals.continuationSignalCount.toLocaleString()} continuation decisions were generated; ${signals.invalidationCount.toLocaleString()} invalidations were recorded.`,
    `${trades.qualifiedPlanCount.toLocaleString()} of ${trades.createdPlanCount.toLocaleString()} analytical plans qualified (${qualificationRate.toFixed(2)}%).`,
    `${trades.enteredPlanCount.toLocaleString()} qualified plans observed an entry fill (${entryFillRate.toFixed(2)}%); ${trades.tp1HitCount.toLocaleString()} reached TP1 and ${trades.completedPlanCount.toLocaleString()} completed.`,
    `${trades.ambiguousPlanCount.toLocaleString()} plans were conservatively marked intrabar-ambiguous (${ambiguityRate.toFixed(2)}%).`,
  ];

  return {
    reportVersion: REPORT_VERSION,
    generatedAtUtc: new Date().toISOString(),
    requestedFromUtc: analysis.meta.requestedFromUtc,
    requestedToUtc: analysis.meta.requestedToUtc,
    symbol: analysis.meta.symbol,
    processingMs: analysis.meta.processingMs,
    dataQuality: {
      received: analysis.quality.received,
      validM1Candles: analysis.quality.valid,
      invalidRecords: analysis.quality.invalid,
      duplicates: analysis.quality.duplicates,
      duplicateConflicts: analysis.quality.duplicateConflicts,
      missingTradableCandles: analysis.quality.missingTradableCandles,
      expectedClosedCandles: analysis.quality.expectedClosedCandles,
      gapCount: analysis.quality.gapCount,
      qualityFlags,
    },
    latestContext: {
      compositeMarketState: analysis.latestMarketState?.composite.state ?? "INSUFFICIENT_DATA",
      compositeDirection: analysis.latestMarketState?.composite.direction ?? "NEUTRAL",
      alignment: analysis.latestMarketState?.composite.alignment ?? "INSUFFICIENT_DATA",
      leadingHypothesis: analysis.latestHypothesisOpportunity?.leadingHypothesis ?? "RANGE",
      leadingHypothesisScore: analysis.latestHypothesisOpportunity?.leadingHypothesisScore ?? 0,
      signalAction: analysis.latestSignalDecision?.action ?? "NONE",
      signalLifecycle: analysis.latestSignalDecision?.lifecycle ?? "OBSERVING",
      tradePlanStatus: analysis.latestTradePlan?.status ?? "NO_SIGNAL",
      tradePlanAction: analysis.latestTradePlan?.action ?? "NONE",
    },
    signalOverview: {
      confirmed: signals.confirmedSignalCount,
      continuations: signals.continuationSignalCount,
      invalidations: signals.invalidationCount,
      buyDecisions: signals.confirmedByDirection.BULLISH,
      sellDecisions: signals.confirmedByDirection.BEARISH,
      duplicateSuppressed: signals.duplicateSuppressedCount,
      expiredCandidates: signals.expiredCandidateCount,
      confirmedByFamily: signals.confirmedByFamily,
      topNoTradeReasons: topCounts(signals.noTradeReasonCounts),
    },
    tradeOverview: {
      created: trades.createdPlanCount,
      qualified: trades.qualifiedPlanCount,
      rejected: trades.rejectedPlanCount,
      entered: trades.enteredPlanCount,
      expired: trades.expiredPlanCount,
      invalidated: trades.invalidatedPlanCount,
      ambiguous: trades.ambiguousPlanCount,
      tp1Hit: trades.tp1HitCount,
      tp2Hit: trades.tp2HitCount,
      completed: trades.completedPlanCount,
      averageRiskDistance: trades.averageRiskDistance,
      averageTp1RiskReward: trades.averageTp1RiskReward,
      averageBarsToEntry: trades.averageBarsToEntry,
      topRejectionReasons: topCounts(trades.rejectionReasonCounts),
    },
    observedRates: {
      qualificationRatePercent: qualificationRate,
      entryFillRatePercent: entryFillRate,
      tp1ProgressRatePercent: tp1ProgressRate,
      completionRatePercent: completionRate,
      intrabarAmbiguityRatePercent: ambiguityRate,
      invalidationsPer100Decisions: invalidationPerDecision,
    },
    comparisonMetrics: {
      m1Candles: analysis.datasets.M1.candles.length,
      m5Candles: analysis.datasets.M5.candles.length,
      m15Candles: analysis.datasets.M15.candles.length,
      h1Candles: analysis.datasets.H1.candles.length,
      d1Candles: analysis.datasets.D1.candles.length,
      confirmedSignals: signals.confirmedSignalCount,
      continuationSignals: signals.continuationSignalCount,
      invalidatedSignals: signals.invalidationCount,
      createdPlans: trades.createdPlanCount,
      qualifiedPlans: trades.qualifiedPlanCount,
      enteredPlans: trades.enteredPlanCount,
      tp1HitPlans: trades.tp1HitCount,
      completedPlans: trades.completedPlanCount,
      ambiguousPlans: trades.ambiguousPlanCount,
      qualificationRatePercent: qualificationRate,
      entryFillRatePercent: entryFillRate,
      tp1ProgressRatePercent: tp1ProgressRate,
      completionRatePercent: completionRate,
    },
    keyFindings,
    diagnosticFlags,
    semantics: "OBSERVED_HISTORICAL_ANALYSIS_NOT_PROFITABILITY_PROOF",
  };
}

function createFamilyBreakdown(
  signalEvents: readonly SignalDecisionHistoryItem[],
  tradePlans: readonly TradePlanHistoryItem[],
): Record<OpportunityFamily, AnalysisReportFamilyBreakdown> {
  const result = Object.fromEntries(
    FAMILIES.map((family) => [
      family,
      {
        confirmedSignals: 0,
        continuationSignals: 0,
        invalidations: 0,
        plansCreated: 0,
        plansQualified: 0,
        entriesObserved: 0,
        tp1Hit: 0,
        completed: 0,
        ambiguous: 0,
      },
    ]),
  ) as Record<OpportunityFamily, AnalysisReportFamilyBreakdown>;

  for (const event of signalEvents) {
    if (event.lifecycle === "CONFIRMED") result[event.family].confirmedSignals += 1;
    else if (event.lifecycle === "CONTINUATION") result[event.family].continuationSignals += 1;
    else result[event.family].invalidations += 1;
  }
  for (const plan of tradePlans) {
    const bucket = result[plan.family];
    bucket.plansCreated += 1;
    if (plan.status !== "REJECTED") bucket.plansQualified += 1;
    if (plan.enteredAtMs !== null) bucket.entriesObserved += 1;
    if (plan.highestTargetHit >= 1) bucket.tp1Hit += 1;
    if (plan.status === "COMPLETED") bucket.completed += 1;
    if (plan.status === "AMBIGUOUS_INTRABAR") bucket.ambiguous += 1;
  }
  return result;
}

export function createAnalysisReport(analysis: CachedAnalysis): AnalysisReport {
  const signalIndex = getOrCreateSignalDecisionIndex(analysis.datasets, {
    dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
  });
  const tradeIndex = getOrCreateTradeManagementIndex(analysis.datasets, {
    dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    settings: analysis.meta.tradeManagementSettings,
  });
  const signalHistory = createSignalDecisionHistory(
    signalIndex,
    analysis.id,
    0,
    Math.max(1, signalIndex.eventSlots.length),
    Math.max(1, signalIndex.eventSlots.length),
  );
  const tradeHistory = createTradePlanHistory(
    tradeIndex,
    analysis.id,
    0,
    Math.max(1, tradeIndex.plans.length),
    Math.max(1, tradeIndex.plans.length),
  );

  return {
    analysisId: analysis.id,
    summary: analysis.reportSummary,
    engineConfiguration: {
      priceBehaviour: PRICE_BEHAVIOUR_CONFIG,
      multiTimeframeState: MULTI_TIMEFRAME_STATE_CONFIG,
      hypothesisOpportunity: HYPOTHESIS_OPPORTUNITY_CONFIG,
      signalDecision: SIGNAL_DECISION_CONFIG,
      tradeManagement: TRADE_MANAGEMENT_CONFIG,
      userTradeSettings: analysis.meta.tradeManagementSettings,
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
      weekendScheduleMode: analysis.meta.weekendScheduleMode,
    },
    timeframeSummaries: {
      candleBehaviour: analysis.behaviourSummaries,
      priceBehaviour: analysis.priceBehaviourSummaries,
      marketState: analysis.marketStateSummary,
      hypothesesAndOpportunities: analysis.hypothesisOpportunitySummary,
      signalDecision: analysis.signalDecisionSummary,
      tradeManagement: analysis.tradeManagementSummary,
    },
    familyBreakdown: createFamilyBreakdown(signalHistory.items, tradeHistory.items),
    signalEvents: signalHistory.items,
    tradePlans: tradeHistory.items,
    dataIssueSamples: analysis.quality.issueSamples,
    gapSamples: analysis.quality.gapSamples,
    semantics: "COMPLETE_HISTORICAL_ANALYSIS_REPORT_FOR_COMPARISON_AND_REVIEW",
  };
}

function mdEscape(value: unknown): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownTable(rows: Array<[string, string | number]>): string {
  return [
    "| Metric | Value |",
    "|---|---:|",
    ...rows.map(([label, value]) => `| ${mdEscape(label)} | ${mdEscape(value)} |`),
  ].join("\n");
}

export function createAnalysisReportMarkdown(report: AnalysisReport): string {
  const summary = report.summary;
  const familyRows = FAMILIES.map((family) => {
    const item = report.familyBreakdown[family];
    return `| ${family} | ${item.confirmedSignals} | ${item.continuationSignals} | ${item.invalidations} | ${item.plansCreated} | ${item.plansQualified} | ${item.entriesObserved} | ${item.tp1Hit} | ${item.completed} | ${item.ambiguous} |`;
  });
  return [
    `# XAUUSD Analysis Report`,
    "",
    `- Analysis ID: \`${report.analysisId}\``,
    `- Generated: ${summary.generatedAtUtc}`,
    `- Period: ${summary.requestedFromUtc} to ${summary.requestedToUtc}`,
    `- Semantics: ${summary.semantics}`,
    "",
    "## Data quality",
    "",
    markdownTable([
      ["Provider records", summary.dataQuality.received],
      ["Valid M1 candles", summary.dataQuality.validM1Candles],
      ["Invalid records", summary.dataQuality.invalidRecords],
      ["Missing tradable candles", summary.dataQuality.missingTradableCandles],
      ["Gap count", summary.dataQuality.gapCount],
    ]),
    "",
    `Flags: ${summary.dataQuality.qualityFlags.join(", ")}`,
    "",
    "## Latest market context",
    "",
    markdownTable([
      ["Composite state", summary.latestContext.compositeMarketState],
      ["Composite direction", summary.latestContext.compositeDirection],
      ["Alignment", summary.latestContext.alignment],
      ["Leading hypothesis", summary.latestContext.leadingHypothesis],
      ["Signal", `${summary.latestContext.signalAction} / ${summary.latestContext.signalLifecycle}`],
      ["Trade plan", `${summary.latestContext.tradePlanAction} / ${summary.latestContext.tradePlanStatus}`],
    ]),
    "",
    "## Signals",
    "",
    markdownTable([
      ["Confirmed", summary.signalOverview.confirmed],
      ["Continuations", summary.signalOverview.continuations],
      ["Invalidations", summary.signalOverview.invalidations],
      ["BUY decisions", summary.signalOverview.buyDecisions],
      ["SELL decisions", summary.signalOverview.sellDecisions],
      ["Duplicates suppressed", summary.signalOverview.duplicateSuppressed],
    ]),
    "",
    "## Trade plans",
    "",
    markdownTable([
      ["Created", summary.tradeOverview.created],
      ["Qualified", summary.tradeOverview.qualified],
      ["Rejected", summary.tradeOverview.rejected],
      ["Entries observed", summary.tradeOverview.entered],
      ["TP1 hit", summary.tradeOverview.tp1Hit],
      ["Completed", summary.tradeOverview.completed],
      ["Intrabar ambiguous", summary.tradeOverview.ambiguous],
      ["Average TP1 R:R", summary.tradeOverview.averageTp1RiskReward],
    ]),
    "",
    "## Observed rates",
    "",
    markdownTable([
      ["Qualification rate", `${summary.observedRates.qualificationRatePercent}%`],
      ["Entry fill rate", `${summary.observedRates.entryFillRatePercent}%`],
      ["TP1 progress rate", `${summary.observedRates.tp1ProgressRatePercent}%`],
      ["Completion rate", `${summary.observedRates.completionRatePercent}%`],
      ["Intrabar ambiguity rate", `${summary.observedRates.intrabarAmbiguityRatePercent}%`],
    ]),
    "",
    "## Family breakdown",
    "",
    "| Family | Confirmed | Continuation | Invalidated | Plans | Qualified | Entries | TP1 | Completed | Ambiguous |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...familyRows,
    "",
    "## Key findings",
    "",
    ...summary.keyFindings.map((item) => `- ${item}`),
    "",
    "## Diagnostic flags",
    "",
    ...summary.diagnosticFlags.map((item) => `- ${item}`),
    "",
    "## Complete event data",
    "",
    `The JSON report contains all ${report.signalEvents.length} signal events and all ${report.tradePlans.length} analytical trade plans.`,
    "",
  ].join("\n");
}
