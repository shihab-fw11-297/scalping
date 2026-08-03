import { TIMEFRAME_MS } from "./constants";
import {
  analyzeMultiTimeframeStateAt,
  getOrCreateMultiTimeframeStateIndex,
} from "./multi-timeframe-state";
import {
  analyzeSessionLiquidityAt,
  getOrCreateSessionLiquidityIndex,
} from "./session-liquidity";
import type { DailyBoundaryMode } from "./market-session";
import type {
  CompactCandle,
  DataIntegrityGrade,
  OpportunityFamily,
  Phase12MultiTimeframeReport,
  Phase12NativeSignal,
  Phase12Outcome,
  Phase12SignalPermission,
  Phase12TimeframeSignalSummary,
  QualityReport,
  SignalOriginTimeframe,
  Timeframe,
  TimeframeDataset,
  TradePlanHistoryItem,
  TradeQualityGrade,
  VisibleDatasetRange,
} from "./types";

const ORIGINS: readonly SignalOriginTimeframe[] = ["M1", "M5", "M15"];
const FAMILIES: readonly OpportunityFamily[] = [
  "PRESSURE_RELEASE",
  "FAILED_BREAK_REVERSAL",
  "IMPULSE_RELOAD",
  "TIMEFRAME_ROTATION",
  "SESSION_LIQUIDITY_QML",
];

export const PHASE12_CONFIG = Object.freeze({
  minimumAverageRangeLookback: 20,
  pressureCompressionBars: 5,
  pressureCompressionMaximumRatio: 0.82,
  pressureExpansionMinimumRatio: 1.15,
  pressureBodyMinimumRatio: 0.5,
  failedBreakLookbackBars: 10,
  failedBreakMinimumPenetrationRanges: 0.05,
  failedBreakMinimumRejectionRatio: 0.25,
  duplicateCooldownBars: { M5: 6, M15: 4 },
  minimumRiskInAverageRanges: 0.2,
  maximumRiskInAverageRanges: 4.5,
  minimumRiskReward: 1.5,
  gradeAMinimumScore: 82,
  gradeBMinimumScore: 68,
  gradeCMinimumScore: 58,
  nativeOutcomeBars: {
    M5: 24,
    M15: 12,
  },
});

interface BuildInput {
  datasets: Record<Timeframe, TimeframeDataset>;
  visibleRanges: Record<Timeframe, VisibleDatasetRange>;
  quality: QualityReport;
  dailyBoundaryMode: DailyBoundaryMode;
  legacyM1Plans: readonly TradePlanHistoryItem[];
}

interface PatternCandidate {
  family: OpportunityFamily;
  direction: "BULLISH" | "BEARISH";
  baseScore: number;
  entryPrice: number;
  stopLossPrice: number;
  reasons: string[];
  warnings: string[];
}

function stable(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function overallDataGrade(quality: QualityReport, visibleM1: number): DataIntegrityGrade {
  const missingRate = quality.missingTradableCandles / Math.max(1, visibleM1 + quality.missingTradableCandles);
  if (missingRate <= 0.02) return "A_DATA";
  if (missingRate <= 0.05) return "B_DATA";
  if (missingRate <= 0.1) return "C_DATA";
  return "INVALID_DATA";
}

function nearestGapBars(quality: QualityReport, timestampMs: number): number | null {
  let nearest = Number.POSITIVE_INFINITY;
  for (const gap of quality.gapSamples) {
    if (gap.missingTradableCandles <= 0) continue;
    const distanceMs = timestampMs < gap.fromTimestampMs
      ? gap.fromTimestampMs - timestampMs
      : timestampMs > gap.toTimestampMs
        ? timestampMs - gap.toTimestampMs
        : 0;
    nearest = Math.min(nearest, Math.ceil(distanceMs / 60_000));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function coverageUsable(dataset: TimeframeDataset, index: number): boolean {
  const coverage = dataset.completeness[index];
  if (!coverage) return false;
  if (coverage.status === "OVERFULL" || coverage.status === "MISSING_DATA") return false;
  if (
    coverage.status === "COMPLETE" ||
    coverage.status === "EXPECTED_MARKET_CLOSURE" ||
    coverage.status === "BOUNDARY_AND_CLOSURE"
  ) return true;
  return coverage.completenessPercent >= 97;
}

function averagePriorRange(candles: readonly CompactCandle[], index: number, lookback: number): number {
  const start = Math.max(0, index - lookback);
  if (index <= start) return 0;
  let sum = 0;
  for (let cursor = start; cursor < index; cursor += 1) sum += candles[cursor][2] - candles[cursor][3];
  return sum / (index - start);
}

function priorExtremes(
  candles: readonly CompactCandle[],
  index: number,
  lookback: number,
): { high: number; low: number } | null {
  const start = index - lookback;
  if (start < 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let cursor = start; cursor < index; cursor += 1) {
    high = Math.max(high, candles[cursor][2]);
    low = Math.min(low, candles[cursor][3]);
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

function pressureReleaseCandidate(
  candles: readonly CompactCandle[],
  index: number,
  averageRange: number,
): PatternCandidate | null {
  const current = candles[index];
  const prior5 = priorExtremes(candles, index, PHASE12_CONFIG.pressureCompressionBars);
  if (!prior5 || averageRange <= 0) return null;
  let compressionRangeSum = 0;
  for (let cursor = index - PHASE12_CONFIG.pressureCompressionBars; cursor < index; cursor += 1) {
    compressionRangeSum += candles[cursor][2] - candles[cursor][3];
  }
  const compressionAverage = compressionRangeSum / PHASE12_CONFIG.pressureCompressionBars;
  const range = Math.max(current[2] - current[3], 1e-9);
  const bodyRatio = Math.abs(current[4] - current[1]) / range;
  const compressed = compressionAverage <= averageRange * PHASE12_CONFIG.pressureCompressionMaximumRatio;
  const expanded = range >= averageRange * PHASE12_CONFIG.pressureExpansionMinimumRatio;
  if (!compressed || !expanded || bodyRatio < PHASE12_CONFIG.pressureBodyMinimumRatio) return null;

  if (current[4] > prior5.high && current[4] > current[1]) {
    const stop = Math.min(current[3], prior5.low) - averageRange * 0.12;
    return {
      family: "PRESSURE_RELEASE",
      direction: "BULLISH",
      baseScore: 60,
      entryPrice: current[4],
      stopLossPrice: stop,
      reasons: ["NATIVE_COMPRESSION_RELEASE", "BULLISH_BODY_CLOSE_BREAK", "FRESH_TIMEFRAME_EXPANSION"],
      warnings: [],
    };
  }
  if (current[4] < prior5.low && current[4] < current[1]) {
    const stop = Math.max(current[2], prior5.high) + averageRange * 0.12;
    return {
      family: "PRESSURE_RELEASE",
      direction: "BEARISH",
      baseScore: 60,
      entryPrice: current[4],
      stopLossPrice: stop,
      reasons: ["NATIVE_COMPRESSION_RELEASE", "BEARISH_BODY_CLOSE_BREAK", "FRESH_TIMEFRAME_EXPANSION"],
      warnings: [],
    };
  }
  return null;
}

function failedBreakCandidate(
  candles: readonly CompactCandle[],
  index: number,
  averageRange: number,
): PatternCandidate | null {
  const current = candles[index];
  const prior = priorExtremes(candles, index, PHASE12_CONFIG.failedBreakLookbackBars);
  if (!prior || averageRange <= 0) return null;
  const range = Math.max(current[2] - current[3], 1e-9);
  const body = Math.abs(current[4] - current[1]);
  const upperWick = current[2] - Math.max(current[1], current[4]);
  const lowerWick = Math.min(current[1], current[4]) - current[3];
  const penetration = averageRange * PHASE12_CONFIG.failedBreakMinimumPenetrationRanges;

  if (
    current[2] > prior.high + penetration &&
    current[4] < prior.high &&
    upperWick / range >= PHASE12_CONFIG.failedBreakMinimumRejectionRatio &&
    (current[4] < current[1] || upperWick > body)
  ) {
    return {
      family: "FAILED_BREAK_REVERSAL",
      direction: "BEARISH",
      baseScore: 58,
      entryPrice: current[4],
      stopLossPrice: current[2] + averageRange * 0.12,
      reasons: ["NATIVE_HIGH_SWEEP", "FAILED_CLOSE_ABOVE_RANGE", "BEARISH_REJECTION"],
      warnings: [],
    };
  }
  if (
    current[3] < prior.low - penetration &&
    current[4] > prior.low &&
    lowerWick / range >= PHASE12_CONFIG.failedBreakMinimumRejectionRatio &&
    (current[4] > current[1] || lowerWick > body)
  ) {
    return {
      family: "FAILED_BREAK_REVERSAL",
      direction: "BULLISH",
      baseScore: 58,
      entryPrice: current[4],
      stopLossPrice: current[3] - averageRange * 0.12,
      reasons: ["NATIVE_LOW_SWEEP", "FAILED_CLOSE_BELOW_RANGE", "BULLISH_REJECTION"],
      warnings: [],
    };
  }
  return null;
}


function impulseReloadCandidate(
  candles: readonly CompactCandle[],
  index: number,
  averageRange: number,
): PatternCandidate | null {
  if (index < 4 || averageRange <= 0) return null;
  const current = candles[index];
  const p1 = candles[index - 1];
  const p2 = candles[index - 2];
  const p3 = candles[index - 3];
  const bullishImpulse = p3[4] > p3[1] && (p3[2] - p3[3]) >= averageRange * 1.2;
  const bearishImpulse = p3[4] < p3[1] && (p3[2] - p3[3]) >= averageRange * 1.2;
  const shallowBullPullback = p2[4] <= p2[1] && p1[3] > p3[3] && p1[4] > p3[1];
  const shallowBearPullback = p2[4] >= p2[1] && p1[2] < p3[2] && p1[4] < p3[1];
  if (bullishImpulse && shallowBullPullback && current[4] > Math.max(p1[2], p2[2]) && current[4] > current[1]) {
    return {
      family: "IMPULSE_RELOAD",
      direction: "BULLISH",
      baseScore: 61,
      entryPrice: current[4],
      stopLossPrice: Math.min(p1[3], p2[3]) - averageRange * 0.1,
      reasons: ["NATIVE_BULLISH_IMPULSE", "SHALLOW_PULLBACK_HELD", "RELOAD_CLOSE_CONFIRMED"],
      warnings: [],
    };
  }
  if (bearishImpulse && shallowBearPullback && current[4] < Math.min(p1[3], p2[3]) && current[4] < current[1]) {
    return {
      family: "IMPULSE_RELOAD",
      direction: "BEARISH",
      baseScore: 61,
      entryPrice: current[4],
      stopLossPrice: Math.max(p1[2], p2[2]) + averageRange * 0.1,
      reasons: ["NATIVE_BEARISH_IMPULSE", "SHALLOW_PULLBACK_HELD", "RELOAD_CLOSE_CONFIRMED"],
      warnings: [],
    };
  }
  return null;
}

function timeframeRotationCandidate(
  candles: readonly CompactCandle[],
  index: number,
  averageRange: number,
): PatternCandidate | null {
  if (index < 8 || averageRange <= 0) return null;
  const current = candles[index];
  const prior = priorExtremes(candles, index, 8);
  if (!prior) return null;
  const previous = candles[index - 1];
  const range = current[2] - current[3];
  if (range < averageRange * 0.9) return null;
  if (previous[4] < previous[1] && current[4] > prior.high && current[4] > current[1]) {
    return {
      family: "TIMEFRAME_ROTATION",
      direction: "BULLISH",
      baseScore: 59,
      entryPrice: current[4],
      stopLossPrice: Math.min(current[3], previous[3]) - averageRange * 0.1,
      reasons: ["NATIVE_BULLISH_ROTATION", "PRIOR_BEARISH_CONTROL_REJECTED", "RANGE_CLOSE_BREAK"],
      warnings: [],
    };
  }
  if (previous[4] > previous[1] && current[4] < prior.low && current[4] < current[1]) {
    return {
      family: "TIMEFRAME_ROTATION",
      direction: "BEARISH",
      baseScore: 59,
      entryPrice: current[4],
      stopLossPrice: Math.max(current[2], previous[2]) + averageRange * 0.1,
      reasons: ["NATIVE_BEARISH_ROTATION", "PRIOR_BULLISH_CONTROL_REJECTED", "RANGE_CLOSE_BREAK"],
      warnings: [],
    };
  }
  return null;
}

function sessionQmlCandidate(
  session: ReturnType<typeof analyzeSessionLiquidityAt>,
  current: CompactCandle,
  averageRange: number,
): PatternCandidate | null {
  const qml = session?.qml;
  if (!qml || qml.stage !== "RETEST_CONFIRMED" || (qml.direction !== "BULLISH" && qml.direction !== "BEARISH")) return null;
  const entry = qml.entryLower !== null && qml.entryUpper !== null
    ? (qml.entryLower + qml.entryUpper) / 2
    : current[4];
  const stop = qml.invalidationPrice ?? (qml.direction === "BULLISH" ? current[3] - averageRange * 0.15 : current[2] + averageRange * 0.15);
  return {
    family: "SESSION_LIQUIDITY_QML",
    direction: qml.direction,
    baseScore: Math.max(62, qml.score),
    entryPrice: entry,
    stopLossPrice: stop,
    reasons: ["NATIVE_QML_RETEST_CONFIRMED", ...qml.reasons.map(String)],
    warnings: qml.blockers.map(String),
  };
}

function gradeForScore(score: number, blocked: boolean): TradeQualityGrade {
  if (blocked) return "BLOCKED";
  if (score >= PHASE12_CONFIG.gradeAMinimumScore) return "A";
  if (score >= PHASE12_CONFIG.gradeBMinimumScore) return "B";
  if (score >= PHASE12_CONFIG.gradeCMinimumScore) return "C";
  return "BLOCKED";
}

function outcomeForNative(
  candles: readonly CompactCandle[],
  signalIndex: number,
  direction: "BULLISH" | "BEARISH",
  stop: number,
  target: number,
  maximumBars: number,
): { outcome: Phase12Outcome; realizedR: number | null } {
  const end = Math.min(candles.length, signalIndex + 1 + maximumBars);
  for (let cursor = signalIndex + 1; cursor < end; cursor += 1) {
    const candle = candles[cursor];
    const stopTouched = direction === "BULLISH" ? candle[3] <= stop : candle[2] >= stop;
    const targetTouched = direction === "BULLISH" ? candle[2] >= target : candle[3] <= target;
    if (stopTouched && targetTouched) return { outcome: "AMBIGUOUS", realizedR: null };
    if (targetTouched) return { outcome: "WIN", realizedR: PHASE12_CONFIG.minimumRiskReward };
    if (stopTouched) return { outcome: "LOSS", realizedR: -1 };
  }
  return { outcome: "OPEN", realizedR: null };
}

function mappings(origin: SignalOriginTimeframe): {
  confirmationTimeframe: "M5" | "M15" | "H1";
  biasTimeframe: "M15" | "H1" | "D1";
} {
  if (origin === "M1") return { confirmationTimeframe: "M5", biasTimeframe: "M15" };
  if (origin === "M5") return { confirmationTimeframe: "M15", biasTimeframe: "H1" };
  return { confirmationTimeframe: "H1", biasTimeframe: "D1" };
}

function legacyOutcome(plan: TradePlanHistoryItem): { outcome: Phase12Outcome; realizedR: number | null } {
  if (plan.status === "AMBIGUOUS_INTRABAR") return { outcome: "AMBIGUOUS", realizedR: null };
  if (plan.enteredAtMs === null) return { outcome: "NO_ENTRY", realizedR: null };
  if (plan.status === "COMPLETED" || plan.highestTargetHit >= 1) {
    return { outcome: "WIN", realizedR: plan.highestTargetHit >= 2 ? 2 : plan.riskRewardToTp1 };
  }
  if (plan.status === "INVALIDATED") return { outcome: "LOSS", realizedR: -1 };
  return { outcome: "OPEN", realizedR: null };
}

function createLegacyM1Signals(
  plans: readonly TradePlanHistoryItem[],
  dataGrade: DataIntegrityGrade,
  quality: QualityReport,
  datasets: Record<Timeframe, TimeframeDataset>,
  dailyBoundaryMode: DailyBoundaryMode,
): Phase12NativeSignal[] {
  const stateIndex = getOrCreateMultiTimeframeStateIndex(datasets, { dailyBoundaryMode });
  return plans.map((plan) => {
    const gapBars = nearestGapBars(quality, plan.signalTimestampMs);
    const hardDataBlock = dataGrade === "INVALID_DATA" || (gapBars !== null && gapBars <= 5);
    const researchOnlyData = dataGrade === "C_DATA";
    const state = analyzeMultiTimeframeStateAt(stateIndex, plan.signalTimestampMs);
    const confirmationDirection = state?.m5.direction ?? "NEUTRAL";
    const biasDirection = state?.m15.direction ?? "NEUTRAL";
    const confirmationPassed = confirmationDirection === plan.direction;
    const biasPassed = biasDirection === plan.direction;
    const grade = hardDataBlock ? "BLOCKED" : plan.qualityGrade;
    const permission: Phase12SignalPermission = hardDataBlock
      ? "BLOCKED"
      : researchOnlyData || !confirmationPassed || !biasPassed
        ? "RESEARCH_ONLY"
        : grade === "A" || grade === "B"
          ? "PAPER_TRADE"
          : "RESEARCH_ONLY";
    const outcome = legacyOutcome(plan);
    const map = mappings("M1");
    return {
      signalId: `M1:${plan.planId}`,
      timestampMs: plan.signalTimestampMs,
      originTimeframe: "M1",
      executionTimeframe: "M1",
      ...map,
      confirmationDirection,
      confirmationPassed,
      biasDirection,
      biasPassed,
      source: "LEGACY_M1_ENGINE",
      family: plan.family,
      direction: plan.direction,
      action: plan.action,
      score: plan.qualityScore,
      grade,
      permission,
      entryPrice: plan.entryPrice ?? plan.entryZone.preferred,
      stopLossPrice: plan.stopLossPrice,
      tp1Price: plan.tp1Price,
      riskReward: plan.riskRewardToTp1,
      dataIntegrityGrade: dataGrade,
      reasons: ["PHASE11_M1_SIGNAL_PRESERVED", ...plan.reasons],
      warnings: [
        ...(hardDataBlock ? ["SOURCE_DATA_NOT_EXECUTION_SAFE"] : []),
        ...(researchOnlyData ? ["C_DATA_RESEARCH_ONLY"] : []),
        ...(!confirmationPassed ? ["M5_CONFIRMATION_FAILED"] : []),
        ...(!biasPassed ? ["M15_BIAS_FAILED"] : []),
        ...(gapBars !== null && gapBars <= 15 ? [`NEARBY_M1_GAP_${gapBars}_BARS`] : []),
      ],
      outcome: outcome.outcome,
      realizedR: outcome.realizedR,
    };
  });
}

function createNativeSignals(
  input: BuildInput,
  origin: "M5" | "M15",
  dataGrade: DataIntegrityGrade,
): Phase12NativeSignal[] {
  const dataset = input.datasets[origin];
  const candles = dataset.candles;
  const visible = input.visibleRanges[origin];
  const stateIndex = getOrCreateMultiTimeframeStateIndex(input.datasets, {
    dailyBoundaryMode: input.dailyBoundaryMode,
  });
  const sessionIndex = getOrCreateSessionLiquidityIndex(input.datasets, input.dailyBoundaryMode);
  const output: Phase12NativeSignal[] = [];
  const lastAcceptedByKey = new Map<string, number>();
  const minimumIndex = Math.max(visible.start, PHASE12_CONFIG.minimumAverageRangeLookback);
  const maximumBars = PHASE12_CONFIG.nativeOutcomeBars[origin];

  for (let index = minimumIndex; index < visible.end; index += 1) {
    if (!coverageUsable(dataset, index)) continue;
    const averageRange = averagePriorRange(candles, index, PHASE12_CONFIG.minimumAverageRangeLookback);
    if (averageRange <= 0) continue;
    const timestampMs = candles[index][0] + TIMEFRAME_MS[origin];
    const state = analyzeMultiTimeframeStateAt(stateIndex, timestampMs);
    const session = analyzeSessionLiquidityAt(sessionIndex, timestampMs);
    const candidates = [
      pressureReleaseCandidate(candles, index, averageRange),
      failedBreakCandidate(candles, index, averageRange),
      impulseReloadCandidate(candles, index, averageRange),
      timeframeRotationCandidate(candles, index, averageRange),
      sessionQmlCandidate(session, candles[index], averageRange),
    ].filter((candidate): candidate is PatternCandidate => candidate !== null);

    for (const candidate of candidates) {
      const key = `${candidate.family}:${candidate.direction}`;
      const previousIndex = lastAcceptedByKey.get(key);
      if (previousIndex !== undefined && index - previousIndex <= PHASE12_CONFIG.duplicateCooldownBars[origin]) continue;
      const confirmationDirection = origin === "M5" ? state?.m15.direction ?? "NEUTRAL" : state?.hourly.direction ?? "NEUTRAL";
      const biasDirection = origin === "M5" ? state?.hourly.direction ?? "NEUTRAL" : state?.daily.direction ?? "NEUTRAL";
      const confirmationPassed = confirmationDirection === candidate.direction;
      const biasPassed = biasDirection === candidate.direction;
      const directionMatches = confirmationPassed && biasPassed;
      const directionOpposes = (confirmationDirection !== "NEUTRAL" && confirmationDirection !== candidate.direction) ||
        (biasDirection !== "NEUTRAL" && biasDirection !== candidate.direction);
      const activeSession = session?.activeSession ?? "OFF_HOURS";
      const productiveLocation = session?.location === "UPPER_EXTERNAL_LIQUIDITY" ||
        session?.location === "LOWER_EXTERNAL_LIQUIDITY" ||
        session?.location === "RANGE_UPPER_EDGE" ||
        session?.location === "RANGE_LOWER_EDGE" ||
        session?.location === "ABOVE_PREVIOUS_DAY" ||
        session?.location === "BELOW_PREVIOUS_DAY";
      const gapBars = nearestGapBars(input.quality, timestampMs);
      const risk = Math.abs(candidate.entryPrice - candidate.stopLossPrice);
      const riskInRanges = risk / averageRange;
      const structurallyInvalidRisk = riskInRanges < PHASE12_CONFIG.minimumRiskInAverageRanges ||
        riskInRanges > PHASE12_CONFIG.maximumRiskInAverageRanges;
      const hardDataBlock = dataGrade === "INVALID_DATA" || (gapBars !== null && gapBars <= 5);
      let score = candidate.baseScore;
      score += dataGrade === "A_DATA" ? 10 : dataGrade === "B_DATA" ? 7 : dataGrade === "C_DATA" ? 2 : -20;
      score += directionMatches ? 10 : directionOpposes ? -8 : 3;
      score += activeSession === "LONDON_NEW_YORK_OVERLAP" ? 9 : activeSession === "LONDON" || activeSession === "NEW_YORK" ? 7 : activeSession === "ASIA" ? 4 : 0;
      score += productiveLocation ? 8 : session?.location === "RANGE_MIDDLE" ? 1 : 3;
      if (gapBars !== null && gapBars <= 15) score -= 6;
      if (candidate.family === "FAILED_BREAK_REVERSAL" && session?.location === "RANGE_MIDDLE") {
        score -= 7;
        candidate.warnings.push("FAILED_BREAK_IN_RANGE_MIDDLE");
      }
      if (structurallyInvalidRisk) score -= 18;
      score = Math.max(0, Math.min(100, Math.round(score * 100) / 100));
      const blocked = hardDataBlock || structurallyInvalidRisk || score < PHASE12_CONFIG.gradeCMinimumScore;
      let grade = gradeForScore(score, blocked);
      if (dataGrade === "B_DATA" && grade === "A") grade = "B";
      if (dataGrade === "C_DATA" && (grade === "A" || grade === "B")) grade = "C";
      const activeExecutionWindow = activeSession === "LONDON" || activeSession === "NEW_YORK" || activeSession === "LONDON_NEW_YORK_OVERLAP";
      const familyLocationEligible = candidate.family === "PRESSURE_RELEASE" || candidate.family === "IMPULSE_RELOAD" || candidate.family === "TIMEFRAME_ROTATION" || productiveLocation;
      const paperEligible = !blocked && confirmationPassed && biasPassed && activeExecutionWindow && familyLocationEligible;
      const permission: Phase12SignalPermission = grade === "BLOCKED"
        ? "BLOCKED"
        : grade === "C" || dataGrade === "C_DATA" || !paperEligible
          ? "RESEARCH_ONLY"
          : "PAPER_TRADE";
      if (!activeExecutionWindow) candidate.warnings.push("OUTSIDE_LONDON_NEW_YORK_EXECUTION_WINDOW");
      if (!familyLocationEligible) candidate.warnings.push("REVERSAL_WITHOUT_EXTERNAL_LIQUIDITY_LOCATION");
      const tp1Price = candidate.direction === "BULLISH"
        ? candidate.entryPrice + risk * PHASE12_CONFIG.minimumRiskReward
        : candidate.entryPrice - risk * PHASE12_CONFIG.minimumRiskReward;
      const outcome = outcomeForNative(
        candles,
        index,
        candidate.direction,
        candidate.stopLossPrice,
        tp1Price,
        maximumBars,
      );
      const map = mappings(origin);
      output.push({
        signalId: `${origin}:${candidate.family}:${candidate.direction}:${timestampMs}`,
        timestampMs,
        originTimeframe: origin,
        executionTimeframe: origin,
        ...map,
        confirmationDirection,
        confirmationPassed,
        biasDirection,
        biasPassed,
        source: "NATIVE_TIMEFRAME_ENGINE",
        family: candidate.family,
        direction: candidate.direction,
        action: candidate.direction === "BULLISH" ? "BUY" : "SELL",
        score,
        grade,
        permission,
        entryPrice: stable(candidate.entryPrice),
        stopLossPrice: stable(candidate.stopLossPrice),
        tp1Price: stable(tp1Price),
        riskReward: PHASE12_CONFIG.minimumRiskReward,
        dataIntegrityGrade: dataGrade,
        reasons: [
          ...candidate.reasons,
          confirmationPassed ? "CONFIRMATION_TIMEFRAME_ALIGNED" : "CONFIRMATION_TIMEFRAME_NOT_ALIGNED",
          biasPassed ? "BIAS_TIMEFRAME_ALIGNED" : "BIAS_TIMEFRAME_NOT_ALIGNED",
          `SESSION_${activeSession}`,
          session?.dataReady ? "LIQUIDITY_CONTEXT_READY" : "LIQUIDITY_CONTEXT_LIMITED",
        ],
        warnings: [
          ...candidate.warnings,
          ...(!confirmationPassed ? [`${map.confirmationTimeframe}_CONFIRMATION_FAILED`] : []),
          ...(!biasPassed ? [`${map.biasTimeframe}_BIAS_FAILED`] : []),
          ...(directionOpposes ? ["COUNTER_HTF_DIRECTION"] : []),
          ...(hardDataBlock ? ["SOURCE_DATA_NOT_EXECUTION_SAFE"] : []),
          ...(gapBars !== null && gapBars <= 15 ? [`NEARBY_M1_GAP_${gapBars}_BARS`] : []),
          ...(structurallyInvalidRisk ? [`RISK_${riskInRanges.toFixed(2)}_AVERAGE_RANGES`] : []),
        ],
        outcome: outcome.outcome,
        realizedR: outcome.realizedR,
      });
      lastAcceptedByKey.set(key, index);
    }
  }
  return output;
}

function emptyFamilyCounts(): Record<OpportunityFamily, number> {
  return Object.fromEntries(FAMILIES.map((family) => [family, 0])) as Record<OpportunityFamily, number>;
}

function summarize(origin: SignalOriginTimeframe, signals: readonly Phase12NativeSignal[]): Phase12TimeframeSignalSummary {
  const familyCounts = emptyFamilyCounts();
  let wins = 0;
  let losses = 0;
  let open = 0;
  let aggregateR = 0;
  let resolved = 0;
  for (const signal of signals) {
    familyCounts[signal.family] += 1;
    if (signal.outcome === "WIN") wins += 1;
    else if (signal.outcome === "LOSS") losses += 1;
    else open += 1;
    if (signal.realizedR !== null) {
      resolved += 1;
      aggregateR += signal.realizedR;
    }
  }
  return {
    originTimeframe: origin,
    generated: signals.length,
    tradeReady: signals.filter((signal) => signal.permission === "TRADE_READY").length,
    paperTrade: signals.filter((signal) => signal.permission === "PAPER_TRADE").length,
    researchOnly: signals.filter((signal) => signal.permission === "RESEARCH_ONLY").length,
    blocked: signals.filter((signal) => signal.permission === "BLOCKED").length,
    gradeA: signals.filter((signal) => signal.grade === "A").length,
    gradeB: signals.filter((signal) => signal.grade === "B").length,
    wins,
    losses,
    open,
    expectancyR: resolved > 0 ? stable(aggregateR / resolved) : null,
    familyCounts,
  };
}

export function createPhase12MultiTimeframeReport(input: BuildInput): Phase12MultiTimeframeReport {
  const dataGrade = overallDataGrade(input.quality, input.visibleRanges.M1.total);
  const m1Signals = createLegacyM1Signals(input.legacyM1Plans, dataGrade, input.quality, input.datasets, input.dailyBoundaryMode);
  const m5Signals = createNativeSignals(input, "M5", dataGrade);
  const m15Signals = createNativeSignals(input, "M15", dataGrade);
  const signals = [...m1Signals, ...m5Signals, ...m15Signals]
    .sort((left, right) => left.timestampMs - right.timestampMs || left.originTimeframe.localeCompare(right.originTimeframe));
  const sessionIndex = getOrCreateSessionLiquidityIndex(input.datasets, input.dailyBoundaryMode);
  const readiness = sessionIndex.summary.readiness;
  const timeframeSummaries = Object.fromEntries(
    ORIGINS.map((origin) => [origin, summarize(origin, signals.filter((signal) => signal.originTimeframe === origin))]),
  ) as Record<SignalOriginTimeframe, Phase12TimeframeSignalSummary>;
  const qmlReadinessFixed = sessionIndex.summary.dataReadySamples > 0 ||
    (readiness.d1UsableClosed >= readiness.minimumRequiredD1 && readiness.h1UsableClosed >= readiness.minimumRequiredH1);
  const diagnostics: string[] = [
    "M1 signals preserve the mature Phase 11 engine; M5 and M15 are independently detected from their own closed candles.",
    "Higher-timeframe tabs no longer represent only projections of M1 events.",
    "H1 and D1 remain context layers because the product is a scalping/intraday engine.",
    "PAPER_TRADE means technically valid but not statistically approved for live risk.",
  ];
  if (!qmlReadinessFixed) diagnostics.push(...readiness.lastFailureReasons);
  if (dataGrade === "C_DATA" || dataGrade === "INVALID_DATA") {
    diagnostics.push("Source period is research-only because missing M1 coverage is above the execution threshold.");
  }
  return {
    architecture: "NATIVE_M1_M5_M15_WITH_HTF_CONTEXT",
    signals,
    timeframeSummaries,
    totalSignals: signals.length,
    totalTradeReady: signals.filter((signal) => signal.permission === "TRADE_READY" || signal.permission === "PAPER_TRADE").length,
    qmlReadinessFixed,
    qmlReadinessDiagnostics: readiness,
    diagnostics,
    semantics: "NATIVE_TIMEFRAME_SIGNALS_NOT_PROFITABILITY_PROOF",
  };
}
