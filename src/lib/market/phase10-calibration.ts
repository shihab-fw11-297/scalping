import type {
  AmbiguityPolicy,
  AnalyticalTradeOutcome,
  CachedAnalysis,
  DataIntegrityGrade,
  GapRecord,
  Phase10CalibrationReport,
  Phase10TradePlanAnalytics,
  RejectionRuleCalibration,
  ScoreCalibrationBucket,
  ShadowPlanOutcome,
  TradeDataIntegrity,
  TradePlanHistoryItem,
  TradePlanRejectionCode,
  TraderReasoning,
} from "./types";

const MINUTE_MS = 60_000;
const SHADOW_BARS = 60;

function stable(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function lowerBoundTimestamp(candles: CachedAnalysis["datasets"]["M1"]["candles"], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (candles[mid][0] < timestampMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

function overallDataGrade(analysis: CachedAnalysis): { grade: DataIntegrityGrade; rate: number; valid: boolean } {
  const visible = analysis.visibleRanges.M1.total;
  const missing = analysis.quality.missingTradableCandles;
  const denominator = Math.max(1, visible + missing);
  const rate = (missing / denominator) * 100;
  const grade: DataIntegrityGrade = rate <= 2
    ? "A_DATA"
    : rate <= 5
      ? "B_DATA"
      : rate <= 10
        ? "C_DATA"
        : "INVALID_DATA";
  return { grade, rate: stable(rate), valid: grade === "A_DATA" || grade === "B_DATA" };
}

function gapDistances(signalTimestampMs: number, gaps: readonly GapRecord[]): { previous: number | null; next: number | null } {
  let previous: number | null = null;
  let next: number | null = null;
  for (const gap of gaps) {
    if (gap.missingTradableCandles <= 0) continue;
    if (gap.toTimestampMs <= signalTimestampMs) {
      const distance = Math.max(0, Math.ceil((signalTimestampMs - gap.toTimestampMs) / MINUTE_MS));
      if (previous === null || distance < previous) previous = distance;
    } else if (gap.fromTimestampMs >= signalTimestampMs) {
      const distance = Math.max(0, Math.ceil((gap.fromTimestampMs - signalTimestampMs) / MINUTE_MS));
      if (next === null || distance < next) next = distance;
    } else {
      previous = 0;
      next = 0;
    }
  }
  return { previous, next };
}

function tradeIntegrity(
  plan: TradePlanHistoryItem,
  analysis: CachedAnalysis,
  overall: ReturnType<typeof overallDataGrade>,
): TradeDataIntegrity {
  const distances = gapDistances(plan.signalTimestampMs, analysis.quality.gapSamples);
  const nearest = [distances.previous, distances.next]
    .filter((value): value is number => value !== null)
    .reduce<number | null>((min, value) => min === null ? value : Math.min(min, value), null);
  const reasons: string[] = [];
  let grade = overall.grade;
  let maximumAllowedSignalGrade: TradeDataIntegrity["maximumAllowedSignalGrade"] = "A";
  if (nearest !== null && nearest <= 5) {
    grade = "INVALID_DATA";
    maximumAllowedSignalGrade = "BLOCKED";
    reasons.push("A missing-data gap is within five M1 bars of the signal.");
  } else if (nearest !== null && nearest <= 15) {
    if (grade === "A_DATA") grade = "B_DATA";
    maximumAllowedSignalGrade = "B";
    reasons.push("A missing-data gap is within fifteen M1 bars of the signal.");
  }
  if (grade === "C_DATA") {
    maximumAllowedSignalGrade = "RESEARCH_ONLY";
    reasons.push("Selected period has more than five percent missing tradable M1 candles.");
  }
  if (grade === "INVALID_DATA") {
    maximumAllowedSignalGrade = "BLOCKED";
    reasons.push("Data integrity is insufficient for official performance statistics.");
  }
  if (reasons.length === 0) reasons.push("No material missing-data gap was found near the signal.");
  return {
    grade,
    overallMissingRatePercent: overall.rate,
    previousGapDistanceBars: distances.previous,
    nextGapDistanceBars: distances.next,
    nearestGapDistanceBars: nearest,
    safeForPerformance: grade === "A_DATA" || grade === "B_DATA",
    maximumAllowedSignalGrade,
    reasons,
  };
}

interface ReplayResult {
  entryFilled: boolean;
  outcome: ShadowPlanOutcome["outcome"];
  entryIndex: number | null;
  outcomeIndex: number | null;
  mfeR: number;
  maeR: number;
  barsToEntry: number | null;
  barsToOutcome: number | null;
  ambiguous: boolean;
}

function replayPlan(plan: TradePlanHistoryItem, analysis: CachedAnalysis, maximumBars = SHADOW_BARS): ReplayResult {
  const candles = analysis.datasets.M1.candles;
  const start = lowerBoundTimestamp(candles, plan.signalTimestampMs);
  const end = Math.min(candles.length, start + maximumBars + 1);
  const bullish = plan.direction === "BULLISH";
  const stop = plan.structuralRisk.stopLossPrice;
  const tp1 = plan.targetSpace.targets.find((target) => target.name === "TP1")?.price ?? null;
  const preferred = plan.entryZone.preferred;
  const risk = Math.max(0.000001, Math.abs(preferred - stop) + plan.executionCosts.totalEstimatedCost);
  let entryIndex: number | null = null;
  let entryPrice = preferred;
  let mfe = 0;
  let mae = 0;
  for (let index = start; index < end; index += 1) {
    const candle = candles[index];
    if (entryIndex === null) {
      const touched = candle[3] <= plan.entryZone.upper && candle[2] >= plan.entryZone.lower;
      if (!touched) continue;
      entryIndex = index;
      entryPrice = Math.min(plan.entryZone.upper, Math.max(plan.entryZone.lower, preferred));
    }
    const favourable = bullish ? candle[2] - entryPrice : entryPrice - candle[3];
    const adverse = bullish ? entryPrice - candle[3] : candle[2] - entryPrice;
    mfe = Math.max(mfe, favourable);
    mae = Math.max(mae, adverse);
    const stopTouched = bullish ? candle[3] <= stop : candle[2] >= stop;
    const tpTouched = tp1 !== null && (bullish ? candle[2] >= tp1 : candle[3] <= tp1);
    if (stopTouched && tpTouched) {
      return { entryFilled: true, outcome: "AMBIGUOUS", entryIndex, outcomeIndex: index, mfeR: mfe / risk, maeR: mae / risk, barsToEntry: entryIndex - start, barsToOutcome: index - entryIndex, ambiguous: true };
    }
    if (stopTouched) return { entryFilled: true, outcome: "STOP", entryIndex, outcomeIndex: index, mfeR: mfe / risk, maeR: mae / risk, barsToEntry: entryIndex - start, barsToOutcome: index - entryIndex, ambiguous: false };
    if (tpTouched) return { entryFilled: true, outcome: "TP1", entryIndex, outcomeIndex: index, mfeR: mfe / risk, maeR: mae / risk, barsToEntry: entryIndex - start, barsToOutcome: index - entryIndex, ambiguous: false };
  }
  return {
    entryFilled: entryIndex !== null,
    outcome: entryIndex === null ? "NO_FILL" : "OPEN",
    entryIndex,
    outcomeIndex: null,
    mfeR: mfe / risk,
    maeR: mae / risk,
    barsToEntry: entryIndex === null ? null : entryIndex - start,
    barsToOutcome: null,
    ambiguous: false,
  };
}

function analyticalOutcome(plan: TradePlanHistoryItem, analysis: CachedAnalysis): AnalyticalTradeOutcome {
  const replay = replayPlan(plan, analysis, 240);
  const candles = analysis.datasets.M1.candles;
  const tp = plan.targetSpace.targets.find((target) => target.name === `TP${Math.max(1, plan.highestTargetHit)}`)?.price
    ?? plan.targetSpace.targets[0]?.price
    ?? null;
  let outcome: AnalyticalTradeOutcome["outcome"] = "UNRESOLVED";
  let exitReason: AnalyticalTradeOutcome["exitReason"] = "OPEN";
  let realizedR: number | null = null;
  let exitPrice: number | null = null;
  if (plan.status === "AMBIGUOUS_INTRABAR" || replay.outcome === "AMBIGUOUS") {
    outcome = "AMBIGUOUS";
    exitReason = "AMBIGUOUS";
  } else if (plan.enteredAtMs === null) {
    outcome = "NO_ENTRY";
    exitReason = plan.status === "EXPIRED" ? "EXPIRED" : "NO_ENTRY";
    realizedR = 0;
  } else if (plan.status === "COMPLETED" || plan.highestTargetHit >= 1) {
    outcome = "WIN";
    exitReason = plan.highestTargetHit >= 3 ? "TP3" : plan.highestTargetHit >= 2 ? "TP2" : "TP1";
    realizedR = plan.targetSpace.targets.find((target) => target.name === exitReason)?.riskReward ?? plan.riskRewardToTp1;
    exitPrice = tp;
  } else if (plan.status === "INVALIDATED") {
    if (plan.highestTargetHit >= 1) {
      outcome = "BREAK_EVEN";
      exitReason = "BREAK_EVEN";
      realizedR = 0;
      exitPrice = plan.entryPrice;
    } else {
      outcome = "LOSS";
      exitReason = "STOP_LOSS";
      realizedR = -1;
      exitPrice = plan.stopLossPrice;
    }
  } else if (plan.status === "ACTIVE" || plan.status === "TARGET1_HIT" || plan.status === "TARGET2_HIT") {
    outcome = "OPEN";
    exitReason = "OPEN";
  }
  const exitTimestampMs = replay.outcomeIndex === null ? null : candles[replay.outcomeIndex]?.[0] + MINUTE_MS;
  return {
    outcome,
    exitReason,
    exitPrice,
    exitTimestampMs,
    realizedR: realizedR === null ? null : stable(realizedR),
    mfeR: stable(replay.mfeR),
    maeR: stable(replay.maeR),
    holdingMinutes: plan.enteredAtMs !== null && exitTimestampMs !== null ? Math.max(0, Math.round((exitTimestampMs - plan.enteredAtMs) / MINUTE_MS)) : null,
    barsToTp1: replay.outcome === "TP1" ? replay.barsToOutcome : null,
    barsToStop: replay.outcome === "STOP" ? replay.barsToOutcome : null,
    semantics: "ANALYTICAL_OHLC_OUTCOME_NOT_BROKER_PNL",
  };
}

function shadowOutcome(plan: TradePlanHistoryItem, analysis: CachedAnalysis): ShadowPlanOutcome | null {
  if (plan.status !== "REJECTED") return null;
  const replay = replayPlan(plan, analysis);
  return {
    evaluated: true,
    entryFilled: replay.entryFilled,
    outcome: replay.outcome,
    barsToEntry: replay.barsToEntry,
    barsToOutcome: replay.barsToOutcome,
    maximumFavourableExcursionR: stable(replay.mfeR),
    maximumAdverseExcursionR: stable(replay.maeR),
    rejectionWouldHaveAvoidedLoss: replay.outcome === "STOP",
    rejectionWouldHaveMissedWinner: replay.outcome === "TP1",
    semantics: "SHADOW_REPLAY_FOR_RULE_CALIBRATION_ONLY",
  };
}

function reasoning(plan: TradePlanHistoryItem, integrity: TradeDataIntegrity): TraderReasoning {
  const direction = plan.direction === "BULLISH" ? "bullish" : "bearish";
  const whyTradeExists = [
    `${plan.family.replaceAll("_", " ")} produced a ${direction} closed-candle decision.`,
    `The planned entry is ${plan.entryZone.lower.toFixed(2)}-${plan.entryZone.upper.toFixed(2)} with ${plan.riskRewardToTp1.toFixed(2)}R to TP1.`,
    ...plan.quality.positiveReasons.slice(0, 4),
  ];
  const whyNotHigherGrade = [
    ...plan.quality.negativeReasons.slice(0, 4),
    ...plan.rejectionReasons.map((code) => code.replaceAll("_", " ").toLowerCase()).slice(0, 3),
  ];
  if (integrity.maximumAllowedSignalGrade !== "A") whyNotHigherGrade.push(`Data permission caps the signal at ${integrity.maximumAllowedSignalGrade}.`);
  return {
    thesis: `${plan.action} ${plan.qualityGrade}: ${plan.family.replaceAll("_", " ")} ${direction} thesis.`,
    whyTradeExists,
    whyNotHigherGrade,
    invalidationNarrative: `The thesis fails beyond ${plan.stopLossPrice.toFixed(2)}; planned structural risk is ${plan.structuralRisk.riskDistance.toFixed(2)} price units.`,
    targetNarrative: `TP1 is ${plan.tp1Price.toFixed(2)} from ${plan.targetSpace.targets[0]?.source ?? "STRUCTURE"}; nearest decision obstacle is ${plan.targetSpace.decisionObstacleSource ?? "none"}.`,
    dataWarning: integrity.safeForPerformance ? null : integrity.reasons.join(" "),
  };
}

function scoreBucket(score: number): string {
  if (score < 65) return "<65";
  if (score < 70) return "65-69";
  if (score < 75) return "70-74";
  if (score < 80) return "75-79";
  if (score < 85) return "80-84";
  return "85+";
}

function calibrationBuckets(analytics: readonly Phase10TradePlanAnalytics[], plans: readonly TradePlanHistoryItem[]): ScoreCalibrationBucket[] {
  const labels = ["<65", "65-69", "70-74", "75-79", "80-84", "85+"];
  return labels.map((label) => {
    const selected = plans.map((plan, index) => ({ plan, analytics: analytics[index] })).filter((item) => scoreBucket(item.plan.qualityScore) === label);
    const resolved = selected.filter((item) => ["WIN", "LOSS", "BREAK_EVEN"].includes(item.analytics.outcome.outcome));
    const wins = resolved.filter((item) => item.analytics.outcome.outcome === "WIN").length;
    const losses = resolved.filter((item) => item.analytics.outcome.outcome === "LOSS").length;
    const breakEven = resolved.filter((item) => item.analytics.outcome.outcome === "BREAK_EVEN").length;
    const values = resolved.map((item) => item.analytics.outcome.realizedR).filter((value): value is number => value !== null);
    const mfe = selected.map((item) => item.analytics.outcome.mfeR).filter((value): value is number => value !== null);
    const mae = selected.map((item) => item.analytics.outcome.maeR).filter((value): value is number => value !== null);
    return {
      bucket: label,
      plans: selected.length,
      entries: selected.filter((item) => item.plan.enteredAtMs !== null).length,
      resolved: resolved.length,
      wins,
      losses,
      breakEven,
      ambiguous: selected.filter((item) => item.analytics.outcome.outcome === "AMBIGUOUS").length,
      winRatePercent: resolved.length > 0 ? stable((wins / resolved.length) * 100) : null,
      averageRealizedR: values.length ? stable(values.reduce((a, b) => a + b, 0) / values.length) : null,
      averageMfeR: mfe.length ? stable(mfe.reduce((a, b) => a + b, 0) / mfe.length) : null,
      averageMaeR: mae.length ? stable(mae.reduce((a, b) => a + b, 0) / mae.length) : null,
    };
  });
}

function rejectionCalibration(analytics: readonly Phase10TradePlanAnalytics[], plans: readonly TradePlanHistoryItem[]): RejectionRuleCalibration[] {
  const map = new Map<TradePlanRejectionCode, RejectionRuleCalibration>();
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const shadow = analytics[index].shadowOutcome;
    if (!shadow) continue;
    for (const code of plan.rejectionReasons) {
      const bucket = map.get(code) ?? { code, rejectedPlans: 0, shadowEntries: 0, lossesAvoided: 0, winnersMissed: 0, noFill: 0, ambiguous: 0 };
      bucket.rejectedPlans += 1;
      if (shadow.entryFilled) bucket.shadowEntries += 1;
      if (shadow.rejectionWouldHaveAvoidedLoss) bucket.lossesAvoided += 1;
      if (shadow.rejectionWouldHaveMissedWinner) bucket.winnersMissed += 1;
      if (shadow.outcome === "NO_FILL") bucket.noFill += 1;
      if (shadow.outcome === "AMBIGUOUS") bucket.ambiguous += 1;
      map.set(code, bucket);
    }
  }
  return [...map.values()].sort((a, b) => b.rejectedPlans - a.rejectedPlans);
}

function policyStats(policy: AmbiguityPolicy, analytics: readonly Phase10TradePlanAnalytics[]) {
  let wins = 0;
  let losses = 0;
  let resolved = 0;
  for (const item of analytics) {
    const outcome = item.outcome.outcome;
    if (outcome === "WIN") { wins += 1; resolved += 1; }
    else if (outcome === "LOSS") { losses += 1; resolved += 1; }
    else if (outcome === "BREAK_EVEN") resolved += 1;
    else if (outcome === "AMBIGUOUS" && policy === "CONSERVATIVE") { losses += 1; resolved += 1; }
    else if (outcome === "AMBIGUOUS" && policy === "CLOSE_CONFIRMATION") {
      // Close-confirmation cannot be reconstructed exactly from one-minute OHLC; keep unresolved.
    }
  }
  return { resolved, wins, losses, winRatePercent: resolved > 0 ? stable((wins / resolved) * 100) : null };
}

export function createPhase10CalibrationReport(
  analysis: CachedAnalysis,
  tradePlans: readonly TradePlanHistoryItem[],
): Phase10CalibrationReport {
  const overall = overallDataGrade(analysis);
  const tradeAnalytics = tradePlans.map((plan): Phase10TradePlanAnalytics => {
    const dataIntegrity = tradeIntegrity(plan, analysis, overall);
    const outcome = analyticalOutcome(plan, analysis);
    return {
      planId: plan.planId,
      dataIntegrity,
      outcome,
      shadowOutcome: shadowOutcome(plan, analysis),
      traderReasoning: reasoning(plan, dataIntegrity),
    };
  });
  const resolvedR = tradeAnalytics.map((item) => item.outcome.realizedR).filter((value): value is number => value !== null);
  const positive = resolvedR.filter((value) => value > 0).reduce((a, b) => a + b, 0);
  const negative = Math.abs(resolvedR.filter((value) => value < 0).reduce((a, b) => a + b, 0));
  const diagnostics: string[] = [];
  if (analysis.sessionLiquiditySummary.dataReadySamples === 0) diagnostics.push("QML_SESSION_LIQUIDITY_NOT_DATA_READY");
  if (!overall.valid) diagnostics.push("OFFICIAL_PERFORMANCE_BLOCKED_BY_DATA_QUALITY");
  const buckets = calibrationBuckets(tradeAnalytics, tradePlans);
  const populated = buckets.filter((bucket) => bucket.resolved >= 5 && bucket.winRatePercent !== null);
  if (populated.length >= 2) {
    for (let index = 1; index < populated.length; index += 1) {
      if ((populated[index].winRatePercent ?? 0) < (populated[index - 1].winRatePercent ?? 0)) {
        diagnostics.push("QUALITY_SCORE_NOT_MONOTONIC_WITH_OUTCOMES");
        break;
      }
    }
  }
  return {
    qmlDataReady: analysis.sessionLiquiditySummary.dataReadySamples > 0,
    dataIntegrityGrade: overall.grade,
    officialPerformanceValid: overall.valid,
    ambiguityPolicies: {
      UNRESOLVED: policyStats("UNRESOLVED", tradeAnalytics),
      CONSERVATIVE: policyStats("CONSERVATIVE", tradeAnalytics),
      CLOSE_CONFIRMATION: policyStats("CLOSE_CONFIRMATION", tradeAnalytics),
    },
    aggregateRealizedR: stable(resolvedR.reduce((a, b) => a + b, 0)),
    profitFactorR: negative > 0 ? stable(positive / negative) : positive > 0 ? null : 0,
    scoreBuckets: buckets,
    rejectionRules: rejectionCalibration(tradeAnalytics, tradePlans),
    tradeAnalytics,
    diagnostics,
    semantics: "PHASE10_CALIBRATION_NOT_PROFITABILITY_GUARANTEE",
  };
}
