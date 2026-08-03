import {
  analyzeMultiTimeframeStateAt,
  getOrCreateMultiTimeframeStateIndex,
} from "./multi-timeframe-state";
import {
  analyzeSessionLiquidityAt,
  getOrCreateSessionLiquidityIndex,
} from "./session-liquidity";
import type {
  AnalyticalTradeOutcome,
  CachedAnalysis,
  CompositeMarketState,
  MarketLocationZone,
  MultiTimeframeStateSnapshot,
  OpportunityFamily,
  Phase10CalibrationReport,
  Phase10TradePlanAnalytics,
  Phase11AuditComponent,
  Phase11AuditGrade,
  Phase11DeploymentPermission,
  Phase11ForwardValidation,
  Phase11PerformanceSlice,
  Phase11ScalpingAuditReport,
  Phase11SignalAudit,
  Phase11SystemGate,
  ScalpingAuditHardVetoCode,
  SessionLiquiditySnapshot,
  TradePlanHistoryItem,
} from "./types";
import type { XauTradingSession } from "./trading-session";

const MINUTE_MS = 60_000;
const TECHNICAL_MAX_SCORE = 90;
const TOTAL_MAX_SCORE = 100;

const FAMILIES: readonly OpportunityFamily[] = [
  "PRESSURE_RELEASE",
  "FAILED_BREAK_REVERSAL",
  "IMPULSE_RELOAD",
  "TIMEFRAME_ROTATION",
  "SESSION_LIQUIDITY_QML",
];

const SESSIONS: readonly XauTradingSession[] = [
  "ASIA",
  "LONDON",
  "NEW_YORK",
  "LONDON_NEW_YORK_OVERLAP",
  "OFF_HOURS",
];

const REGIMES: readonly CompositeMarketState[] = [
  "TREND_CONTINUATION",
  "CORRECTION",
  "ROTATION",
  "EXPANSION",
  "COMPRESSION",
  "RANGE",
  "NOISE",
  "TRANSITION",
  "INSUFFICIENT_DATA",
];

function stable(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return stable(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function contextAt(
  analysis: CachedAnalysis,
  plan: TradePlanHistoryItem,
): { state: MultiTimeframeStateSnapshot | null; liquidity: SessionLiquiditySnapshot | null } {
  const anchor = plan.signalTimestampMs;
  try {
    const state = analyzeMultiTimeframeStateAt(
      getOrCreateMultiTimeframeStateIndex(analysis.datasets, {
        dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
      }),
      anchor,
    );
    const liquidity = analyzeSessionLiquidityAt(
      getOrCreateSessionLiquidityIndex(analysis.datasets, analysis.meta.dailyBoundaryMode),
      anchor,
    );
    return { state, liquidity };
  } catch {
    return { state: null, liquidity: null };
  }
}

function component(
  category: Phase11AuditComponent["category"],
  score: number,
  maxScore: number,
  checks: string[],
  warnings: string[] = [],
): Phase11AuditComponent {
  return {
    category,
    score: stable(clamp(score, 0, maxScore)),
    maxScore,
    checks,
    warnings,
  };
}

function isReversalFamily(family: OpportunityFamily): boolean {
  return family === "FAILED_BREAK_REVERSAL" || family === "SESSION_LIQUIDITY_QML";
}

function isExternalLocation(location: MarketLocationZone): boolean {
  return location === "ABOVE_PREVIOUS_DAY" ||
    location === "UPPER_EXTERNAL_LIQUIDITY" ||
    location === "RANGE_UPPER_EDGE" ||
    location === "RANGE_LOWER_EDGE" ||
    location === "LOWER_EXTERNAL_LIQUIDITY" ||
    location === "BELOW_PREVIOUS_DAY";
}

function dataComponent(
  analytics: Phase10TradePlanAnalytics,
): Phase11AuditComponent {
  const integrity = analytics.dataIntegrity;
  const checks: string[] = [];
  const warnings: string[] = [];
  let score = integrity.grade === "A_DATA"
    ? 15
    : integrity.grade === "B_DATA"
      ? 11
      : integrity.grade === "C_DATA"
        ? 5
        : 0;
  checks.push(`Period data grade: ${integrity.grade}.`);
  checks.push(`Missing tradable M1 rate: ${integrity.overallMissingRatePercent.toFixed(2)}%.`);
  if (integrity.nearestGapDistanceBars === null) {
    checks.push("No missing-data gap was detected around the signal.");
  } else {
    checks.push(`Nearest missing-data gap: ${integrity.nearestGapDistanceBars} M1 bars.`);
  }
  if (integrity.maximumAllowedSignalGrade === "B") {
    score = Math.min(score, 11);
    warnings.push("Nearby data quality caps the executable grade at B.");
  } else if (integrity.maximumAllowedSignalGrade === "RESEARCH_ONLY") {
    score = Math.min(score, 5);
    warnings.push("The selected period is research-only because of missing data.");
  } else if (integrity.maximumAllowedSignalGrade === "BLOCKED") {
    score = 0;
    warnings.push("Data integrity blocks executable use of this signal.");
  }
  return component("DATA_INTEGRITY", score, 15, checks, warnings);
}

function regimeCompatibility(family: OpportunityFamily, state: CompositeMarketState): number {
  if (state === "NOISE" || state === "INSUFFICIENT_DATA") return 0;
  if (family === "PRESSURE_RELEASE") {
    if (state === "COMPRESSION" || state === "EXPANSION" || state === "TREND_CONTINUATION") return 4;
    if (state === "CORRECTION" || state === "TRANSITION") return 2;
    return 1;
  }
  if (family === "FAILED_BREAK_REVERSAL" || family === "SESSION_LIQUIDITY_QML") {
    if (state === "RANGE" || state === "ROTATION" || state === "CORRECTION") return 4;
    if (state === "TRANSITION") return 3;
    if (state === "TREND_CONTINUATION") return 2;
    return 1;
  }
  if (family === "IMPULSE_RELOAD") {
    if (state === "TREND_CONTINUATION" || state === "CORRECTION") return 4;
    if (state === "EXPANSION" || state === "TRANSITION") return 2;
    return 1;
  }
  return state === "ROTATION" ? 3 : 1;
}

function htfComponent(
  plan: TradePlanHistoryItem,
  state: MultiTimeframeStateSnapshot | null,
): Phase11AuditComponent {
  if (!state) {
    return component("HTF_CONTEXT", 0, 10, [], ["Higher-timeframe context was unavailable at the signal timestamp."]);
  }
  const checks: string[] = [
    `Composite regime: ${state.composite.state}.`,
    `Composite direction: ${state.composite.direction}.`,
    `Timeframe alignment: ${state.composite.alignment}.`,
    `Available context layers: ${state.composite.availableLayers}.`,
  ];
  const warnings: string[] = [];
  let score = clamp((state.composite.availableLayers / 6) * 3, 0, 3);
  score += regimeCompatibility(plan.family, state.composite.state);
  if (state.composite.direction === plan.direction) score += 2;
  else if (state.composite.direction === "NEUTRAL") {
    score += 1;
    warnings.push("Composite direction is neutral.");
  } else {
    warnings.push("Signal direction conflicts with the composite higher-timeframe direction.");
  }
  if (state.composite.alignment === "FRESH_ALIGNMENT" || state.composite.alignment === "MATURE_ALIGNMENT") score += 1;
  else if (state.composite.alignment === "PRODUCTIVE_DISAGREEMENT") score += 0.75;
  else if (state.composite.alignment === "DESTRUCTIVE_DISAGREEMENT") warnings.push("Timeframes are destructively misaligned.");
  if (state.composite.state === "NOISE") warnings.push("Composite market state is NOISE.");
  return component("HTF_CONTEXT", score, 10, checks, warnings);
}

function sessionComponent(liquidity: SessionLiquiditySnapshot | null): Phase11AuditComponent {
  const session = liquidity?.activeSession ?? "OFF_HOURS";
  const checks = [`Active session: ${session}.`];
  const warnings: string[] = [];
  let score = session === "LONDON_NEW_YORK_OVERLAP"
    ? 10
    : session === "LONDON" || session === "NEW_YORK"
      ? 9
      : session === "ASIA"
        ? 5
        : 2;
  if (session === "ASIA") warnings.push("Asia-session signals require stronger location and liquidity evidence.");
  if (session === "OFF_HOURS") warnings.push("Off-hours execution has lower liquidity and is not treated as premium scalping time.");
  if (!liquidity?.dataReady) {
    score = Math.min(score, 4);
    warnings.push("Session/liquidity context is not data-ready.");
  }
  return component("SESSION_QUALITY", score, 10, checks, warnings);
}

function liquidityComponent(
  plan: TradePlanHistoryItem,
  liquidity: SessionLiquiditySnapshot | null,
): Phase11AuditComponent {
  if (!liquidity) {
    return component("LIQUIDITY_LOCATION", 0, 15, [], ["Liquidity snapshot was unavailable."]);
  }
  const checks: string[] = [
    `Market location: ${liquidity.location}.`,
    `Liquidity engine ready: ${liquidity.dataReady ? "YES" : "NO"}.`,
  ];
  const warnings: string[] = [];
  let score = liquidity.dataReady ? 3 : 0;
  if (isExternalLocation(liquidity.location)) score += 5;
  else if (liquidity.location === "RANGE_MIDDLE") {
    score += isReversalFamily(plan.family) ? 0 : 2;
    warnings.push("Price is in the middle of the mapped range.");
  } else if (liquidity.location === "UNAVAILABLE") {
    warnings.push("Market location is unavailable.");
  } else score += 2;

  const sweep = liquidity.latestSweep;
  if (sweep) {
    const ageMinutes = Math.max(0, (plan.signalTimestampMs - sweep.timestampMs) / MINUTE_MS);
    const directionalMatch = sweep.direction === plan.direction;
    checks.push(`${sweep.levelType} sweep age: ${stable(ageMinutes)} minutes; direction match: ${directionalMatch ? "YES" : "NO"}.`);
    if (directionalMatch && ageMinutes <= 30) score += 4;
    else if (directionalMatch && ageMinutes <= 120) score += 2;
    else if (isReversalFamily(plan.family)) warnings.push("No fresh directional liquidity sweep supports the reversal.");
  } else if (isReversalFamily(plan.family)) {
    warnings.push("No meaningful liquidity sweep supports the reversal setup.");
  }

  const opposite = plan.direction === "BULLISH" ? liquidity.nearestLiquidityAbove : liquidity.nearestLiquidityBelow;
  if (opposite) {
    score += 3;
    checks.push(`Opposite liquidity target: ${opposite.type} at ${opposite.price.toFixed(2)}.`);
  } else {
    warnings.push("No mapped opposite-side liquidity objective is available.");
  }
  return component("LIQUIDITY_LOCATION", score, 15, checks, warnings);
}

function setupComponent(
  plan: TradePlanHistoryItem,
  liquidity: SessionLiquiditySnapshot | null,
): Phase11AuditComponent {
  const checks: string[] = [
    `Strategy family: ${plan.family}.`,
    `Candidate score: ${plan.candidateScore.toFixed(2)}.`,
    `Original pattern component: ${plan.quality.components.pattern.toFixed(2)}/20.`,
  ];
  const warnings: string[] = [];
  let score = clamp((plan.quality.components.pattern / 20) * 5, 0, 5);
  if (plan.reasons.includes("PHASE6_CONFIRMED")) score += 3;
  else if (plan.reasons.includes("PHASE6_CONTINUATION")) score += 2;
  else warnings.push("No primary Phase 6 confirmation reason is attached.");

  if (plan.family === "SESSION_LIQUIDITY_QML") {
    const qml = liquidity?.qml;
    if (qml?.stage === "RETEST_CONFIRMED") score += 4;
    else warnings.push(`QML retest is not confirmed; current stage is ${qml?.stage ?? "UNAVAILABLE"}.`);
    if (qml?.firstRetest) {
      score += 3;
      checks.push("First QML retest confirmed.");
    } else if (qml?.retestCount === 2) {
      score += 2;
      checks.push("Controlled second QML retest confirmed.");
    }
    if (qml?.structureShift?.type === "MSS") checks.push("Body-close MSS supports the QML setup.");
  } else {
    if (plan.candidateScore >= 70) score += 3;
    else if (plan.candidateScore >= 55) score += 2;
    else score += 1;
    if (plan.quality.positiveReasons.length >= 2) score += 2;
    if (plan.rejectionReasons.length === 0) score += 2;
  }
  return component("SETUP_STRUCTURE", score, 15, checks, warnings);
}

function entryComponent(
  plan: TradePlanHistoryItem,
  liquidity: SessionLiquiditySnapshot | null,
): Phase11AuditComponent {
  const checks: string[] = [
    `Entry zone: ${plan.entryZone.lower.toFixed(2)}-${plan.entryZone.upper.toFixed(2)}.`,
    `No-chase price: ${plan.entryZone.noChasePrice.toFixed(2)}.`,
    `Original timing component: ${plan.quality.components.timing.toFixed(2)}/15.`,
  ];
  const warnings: string[] = [];
  let score = clamp((plan.quality.components.timing / 15) * 5, 0, 5);
  if (!plan.rejectionReasons.includes("ENTRY_ALREADY_LATE")) score += 2;
  else warnings.push("Entry was already late when the plan was created.");
  if (plan.entryZone.lower < plan.entryZone.upper && plan.entryZone.validForBars > 0) score += 1;
  else warnings.push("Entry zone geometry or expiry is invalid.");
  if (plan.family === "SESSION_LIQUIDITY_QML") {
    if (liquidity?.qml.firstRetest) score += 2;
    else if (liquidity?.qml.retestCount === 2) score += 1;
  } else {
    if (plan.executionCosts.totalEstimatedCost <= Math.max(0.01, plan.structuralRisk.riskDistance * 0.25)) score += 2;
    else warnings.push("Estimated execution cost is large relative to structural risk.");
  }
  return component("ENTRY_QUALITY", score, 10, checks, warnings);
}

function riskComponent(plan: TradePlanHistoryItem): Phase11AuditComponent {
  const checks: string[] = [
    `Structural risk distance: ${plan.structuralRisk.riskDistance.toFixed(2)}.`,
    `Risk in average ranges: ${plan.structuralRisk.riskInAverageRanges.toFixed(2)}.`,
    `Safety buffer: ${plan.structuralRisk.safetyBuffer.toFixed(2)}.`,
  ];
  const warnings: string[] = [];
  let score = 0;
  if (Number.isFinite(plan.stopLossPrice) && plan.structuralRisk.riskDistance > 0) score += 2;
  else warnings.push("Structural stop is invalid.");
  if (plan.structuralRisk.riskInAverageRanges >= 0.25 && plan.structuralRisk.riskInAverageRanges <= 3.5) score += 2;
  else warnings.push("Stop distance is outside the normal configured volatility range.");
  if (plan.structuralRisk.safetyBuffer >= 0 && plan.structuralRisk.totalRiskWithCosts >= plan.structuralRisk.riskDistance) score += 1;
  return component("RISK_STRUCTURE", score, 5, checks, warnings);
}

function targetComponent(plan: TradePlanHistoryItem): Phase11AuditComponent {
  const checks: string[] = [
    `Cost-adjusted TP1 R:R: ${plan.riskRewardToTp1.toFixed(2)}.`,
    `Available target-space R:R: ${plan.targetSpace.availableRiskReward.toFixed(2)}.`,
    `Decision obstacle: ${plan.targetSpace.decisionObstacleSource ?? "NONE"}.`,
  ];
  const warnings: string[] = [];
  let score = plan.riskRewardToTp1 >= 2.5
    ? 5
    : plan.riskRewardToTp1 >= 2
      ? 4
      : plan.riskRewardToTp1 >= 1.5
        ? 3
        : 0;
  if (plan.riskRewardToTp1 < 1.5) warnings.push("Cost-adjusted R:R is below the configured 1.5R minimum.");
  if (plan.targetSpace.decisionObstacleClass === "HARD" && plan.targetSpace.availableRiskReward < 1.5) {
    warnings.push("A hard obstacle removes minimum target space.");
  } else score += 2;
  const tp1Source = plan.targetSpace.targets.find((target) => target.name === "TP1")?.source;
  if (tp1Source && tp1Source !== "R_MULTIPLE" && tp1Source !== "EXPECTED_10M_CAPACITY" && tp1Source !== "EXPANSION") score += 2;
  else warnings.push("TP1 is not anchored to a mapped external or higher-timeframe liquidity level.");
  if (plan.executionCosts.totalEstimatedCost >= 0) score += 1;
  return component("TARGET_QUALITY", score, 10, checks, warnings);
}

function hardVetoes(
  plan: TradePlanHistoryItem,
  analytics: Phase10TradePlanAnalytics,
  state: MultiTimeframeStateSnapshot | null,
  liquidity: SessionLiquiditySnapshot | null,
): ScalpingAuditHardVetoCode[] {
  const vetoes = new Set<ScalpingAuditHardVetoCode>();
  if (plan.status === "REJECTED" || plan.qualityGrade === "BLOCKED") vetoes.add("PLAN_REJECTED");
  if (analytics.dataIntegrity.maximumAllowedSignalGrade === "BLOCKED") vetoes.add("DATA_GAP_NEAR_SIGNAL");
  if (analytics.dataIntegrity.grade === "INVALID_DATA") vetoes.add("SOURCE_DATA_INVALID");
  if (state?.composite.state === "NOISE") vetoes.add("NOISE_REGIME");
  const confirmedQmlChain = plan.family === "SESSION_LIQUIDITY_QML" &&
    liquidity?.qml.stage === "RETEST_CONFIRMED" &&
    liquidity.qml.sweep !== null &&
    liquidity.qml.structureShift !== null;
  if (isReversalFamily(plan.family) && liquidity?.location === "RANGE_MIDDLE" && !confirmedQmlChain) {
    vetoes.add("RANGE_MIDDLE_REVERSAL");
  }
  if (plan.family === "SESSION_LIQUIDITY_QML" && !liquidity?.dataReady) vetoes.add("QML_CONTEXT_NOT_READY");
  if (plan.family === "SESSION_LIQUIDITY_QML" && liquidity?.qml.stage !== "RETEST_CONFIRMED") vetoes.add("QML_RETEST_NOT_CONFIRMED");
  if (plan.family === "SESSION_LIQUIDITY_QML" && liquidity?.qml.retestCount && liquidity.qml.retestCount > 2) vetoes.add("THIRD_OR_LATER_RETEST");
  if (plan.family === "TIMEFRAME_ROTATION") vetoes.add("TIMEFRAME_ROTATION_CONTEXT_ONLY");
  const initiallyBlocked = plan.status === "REJECTED" || plan.qualityGrade === "BLOCKED" || !plan.tradeReady;
  if (initiallyBlocked && plan.rejectionReasons.includes("ENTRY_ALREADY_LATE")) vetoes.add("ENTRY_ALREADY_LATE");
  if (initiallyBlocked && (plan.rejectionReasons.includes("INVALID_STRUCTURAL_STOP") || plan.rejectionReasons.includes("STOP_DISTANCE_TOO_SMALL"))) vetoes.add("INVALID_STRUCTURAL_STOP");
  if ((initiallyBlocked && plan.rejectionReasons.includes("RR_BELOW_MINIMUM")) || plan.riskRewardToTp1 < 1.5) vetoes.add("RR_BELOW_MINIMUM");
  if (initiallyBlocked && plan.rejectionReasons.includes("PARTIAL_SOURCE_DATA")) vetoes.add("PARTIAL_SOURCE_DATA");
  return [...vetoes];
}

function technicalGrade(technicalScore: number, vetoes: readonly ScalpingAuditHardVetoCode[]): Phase11AuditGrade {
  if (vetoes.length > 0) return "BLOCKED";
  const percent = technicalScore / TECHNICAL_MAX_SCORE * 100;
  if (percent >= 85) return "A";
  if (percent >= 70) return "B";
  if (percent >= 60) return "C";
  return "BLOCKED";
}

interface PerformanceItem {
  key: string;
  plan: TradePlanHistoryItem;
  analytics: Phase10TradePlanAnalytics;
}

function performanceSlice(key: string, items: readonly PerformanceItem[]): Phase11PerformanceSlice {
  const entered = items.filter((item) => item.plan.enteredAtMs !== null);
  const resolved = entered.filter((item) => ["WIN", "LOSS", "BREAK_EVEN"].includes(item.analytics.outcome.outcome));
  const wins = resolved.filter((item) => item.analytics.outcome.outcome === "WIN");
  const losses = resolved.filter((item) => item.analytics.outcome.outcome === "LOSS");
  const breakEven = resolved.filter((item) => item.analytics.outcome.outcome === "BREAK_EVEN");
  const ambiguous = entered.filter((item) => item.analytics.outcome.outcome === "AMBIGUOUS");
  const rValues = resolved
    .map((item) => item.analytics.outcome.realizedR)
    .filter((value): value is number => value !== null);
  const positive = rValues.filter((value) => value > 0);
  const negative = rValues.filter((value) => value < 0);
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  let losingStreak = 0;
  let maximumLosingStreak = 0;
  const ordered = [...resolved].sort((a, b) => a.plan.signalTimestampMs - b.plan.signalTimestampMs);
  for (const item of ordered) {
    const r = item.analytics.outcome.realizedR ?? 0;
    equity += r;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    if (r < 0) {
      losingStreak += 1;
      maximumLosingStreak = Math.max(maximumLosingStreak, losingStreak);
    } else losingStreak = 0;
  }
  const grossProfit = positive.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(negative.reduce((sum, value) => sum + value, 0));
  return {
    key,
    plans: items.length,
    entered: entered.length,
    resolved: resolved.length,
    wins: wins.length,
    losses: losses.length,
    breakEven: breakEven.length,
    ambiguous: ambiguous.length,
    aggregateR: stable(rValues.reduce((sum, value) => sum + value, 0)),
    expectancyR: average(rValues),
    winRatePercent: resolved.length > 0 ? stable(wins.length / resolved.length * 100) : null,
    profitFactorR: grossLoss > 0 ? stable(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageWinnerR: average(positive),
    averageLoserR: average(negative),
    maximumDrawdownR: stable(maximumDrawdown),
    maximumLosingStreak,
  };
}

function groupPerformance(
  items: readonly PerformanceItem[],
  keys: readonly string[],
): Phase11PerformanceSlice[] {
  return keys.map((key) => performanceSlice(key, items.filter((item) => item.key === key)));
}

function forwardValidation(items: readonly PerformanceItem[]): Phase11ForwardValidation {
  const eligible = [...items]
    .filter((item) => item.analytics.dataIntegrity.safeForPerformance)
    .filter((item) => ["WIN", "LOSS", "BREAK_EVEN"].includes(item.analytics.outcome.outcome))
    .sort((a, b) => a.plan.signalTimestampMs - b.plan.signalTimestampMs);
  const calibrationCount = Math.floor(eligible.length * 0.7);
  const calibration = performanceSlice("CALIBRATION_70", eligible.slice(0, calibrationCount));
  const forward = performanceSlice("FORWARD_30", eligible.slice(calibrationCount));
  const sampleSufficient = forward.resolved >= 50;
  const positive = (forward.expectancyR ?? 0) > 0 && (forward.profitFactorR ?? 0) >= 1.2;
  return {
    method: "CHRONOLOGICAL_70_30_HOLDOUT",
    calibration,
    forward,
    sampleSufficient,
    positive,
  };
}

function familyEvidenceScore(
  family: OpportunityFamily,
  familyStats: readonly Phase11PerformanceSlice[],
  forward: Phase11ForwardValidation,
): number {
  const stats = familyStats.find((item) => item.key === family);
  if (!stats) return 0;
  let score = stats.resolved >= 100 ? 4 : stats.resolved >= 30 ? 3 : stats.resolved >= 10 ? 2 : stats.resolved >= 5 ? 1 : 0;
  if ((stats.expectancyR ?? 0) > 0) score += 2;
  if ((stats.profitFactorR ?? 0) >= 1.2) score += 2;
  if (forward.sampleSufficient && forward.positive) score += 2;
  else if (forward.positive) score += 1;
  return clamp(score, 0, 10);
}

function gradePerformance(
  plans: readonly TradePlanHistoryItem[],
  analytics: readonly Phase10TradePlanAnalytics[],
  audits: readonly Phase11SignalAudit[],
): Phase11PerformanceSlice[] {
  const entries = plans.map((plan, index): PerformanceItem & { grade: Phase11AuditGrade } => ({
    key: audits[index]?.grade ?? "BLOCKED",
    grade: audits[index]?.grade ?? "BLOCKED",
    plan,
    analytics: analytics[index],
  }));
  return (["A", "B", "C", "BLOCKED"] as const).map((grade) => performanceSlice(grade, entries.filter((item) => item.grade === grade)));
}

function gate(
  code: string,
  passed: boolean,
  current: number | string | boolean | null,
  required: string,
  requiredForLive: boolean,
): Phase11SystemGate {
  return { code, passed, current, required, requiredForLive };
}

function systemScore(input: {
  phase10: Phase10CalibrationReport;
  overall: Phase11PerformanceSlice;
  family: readonly Phase11PerformanceSlice[];
  grades: readonly Phase11PerformanceSlice[];
  forward: Phase11ForwardValidation;
  analysis: CachedAnalysis;
}): number {
  let score = input.phase10.dataIntegrityGrade === "A_DATA" ? 15 : input.phase10.dataIntegrityGrade === "B_DATA" ? 10 : input.phase10.dataIntegrityGrade === "C_DATA" ? 5 : 0;
  if (input.phase10.qmlDataReady) score += 6;
  if (input.analysis.sessionLiquiditySummary.sweepCount > 0) score += 2;
  if (input.analysis.sessionLiquiditySummary.mssCount > 0) score += 1;
  if (input.analysis.sessionLiquiditySummary.qmlRetestConfirmedCount > 0) score += 1;
  score += clamp(input.overall.resolved / 300 * 10, 0, 10);
  const primaryResolved = Math.max(...input.family.map((item) => item.resolved), 0);
  score += clamp(primaryResolved / 100 * 5, 0, 5);
  score += clamp(input.forward.forward.resolved / 50 * 5, 0, 5);
  if ((input.overall.expectancyR ?? 0) > 0) score += 8;
  if ((input.overall.profitFactorR ?? 0) >= 1.2) score += 8;
  else if ((input.overall.profitFactorR ?? 0) >= 1) score += 4;
  if (input.overall.aggregateR > 0) score += 4;
  if ((input.forward.forward.expectancyR ?? 0) > 0) score += 3;
  if ((input.forward.forward.profitFactorR ?? 0) >= 1.2) score += 2;
  if (input.overall.maximumDrawdownR <= 10) score += 6;
  else if (input.overall.maximumDrawdownR <= 15) score += 3;
  if (input.overall.maximumLosingStreak <= 6) score += 4;
  const ambiguityRate = input.overall.entered > 0 ? input.overall.ambiguous / input.overall.entered * 100 : 100;
  if (ambiguityRate <= 10) score += 5;
  else if (ambiguityRate <= 20) score += 2;
  const gradeA = input.grades.find((item) => item.key === "A");
  const gradeB = input.grades.find((item) => item.key === "B");
  if (gradeA && gradeB && gradeA.resolved >= 20 && gradeB.resolved >= 20 && (gradeA.expectancyR ?? -Infinity) > (gradeB.expectancyR ?? Infinity)) score += 5;
  if (!input.phase10.diagnostics.includes("QUALITY_SCORE_NOT_MONOTONIC_WITH_OUTCOMES")) score += 5;
  if (input.family.filter((item) => item.resolved >= 20 && (item.expectancyR ?? 0) > 0).length >= 2) score += 5;
  return stable(clamp(score, 0, TOTAL_MAX_SCORE));
}

export function createPhase11ScalpingAuditReport(
  analysis: CachedAnalysis,
  tradePlans: readonly TradePlanHistoryItem[],
  phase10: Phase10CalibrationReport,
): Phase11ScalpingAuditReport {
  const phase10ById = new Map(phase10.tradeAnalytics.map((item) => [item.planId, item]));
  const context = tradePlans.map((plan) => contextAt(analysis, plan));
  const analytics = tradePlans.map((plan): Phase10TradePlanAnalytics => {
    const item = phase10ById.get(plan.planId);
    if (!item) throw new Error(`Phase 11 requires Phase 10 analytics for plan ${plan.planId}.`);
    return item;
  });

  const familyItems: PerformanceItem[] = tradePlans.map((plan, index) => ({
    key: plan.family,
    plan,
    analytics: analytics[index],
  }));
  const familyPerformance = groupPerformance(familyItems, FAMILIES);
  const forward = forwardValidation(familyItems);

  const baseAudits = tradePlans.map((plan, index): Phase11SignalAudit => {
    const planAnalytics = analytics[index];
    const state = context[index].state;
    const liquidity = context[index].liquidity;
    const components = [
      dataComponent(planAnalytics),
      htfComponent(plan, state),
      sessionComponent(liquidity),
      liquidityComponent(plan, liquidity),
      setupComponent(plan, liquidity),
      entryComponent(plan, liquidity),
      riskComponent(plan),
      targetComponent(plan),
    ];
    const technicalScore = stable(components.reduce((sum, item) => sum + item.score, 0));
    const vetoes = hardVetoes(plan, planAnalytics, state, liquidity);
    const grade = technicalGrade(technicalScore, vetoes);
    const softWarnings = [...new Set(components.flatMap((item) => item.warnings))];
    return {
      planId: plan.planId,
      family: plan.family,
      direction: plan.direction,
      signalTimestampMs: plan.signalTimestampMs,
      technicalScore,
      evidenceScore: 0,
      totalScore: technicalScore,
      grade,
      deploymentPermission: vetoes.length > 0 ? "BLOCKED" : grade === "C" ? "RESEARCH_ONLY" : "PAPER_TRADE",
      suggestedRiskPercent: 0,
      hardVetoes: vetoes,
      softWarnings,
      components,
      context: {
        session: liquidity?.activeSession ?? "OFF_HOURS",
        regime: state?.composite.state ?? "INSUFFICIENT_DATA",
        alignment: state?.composite.alignment ?? "INSUFFICIENT_DATA",
        marketLocation: liquidity?.location ?? "UNAVAILABLE",
        qmlStage: liquidity?.qml.stage ?? "NONE",
        retestCount: liquidity?.qml.retestCount ?? 0,
      },
      semantics: "PROFESSIONAL_SCALPING_AUDIT_NOT_PROFITABILITY_GUARANTEE",
    };
  });

  const initialGradePerformance = gradePerformance(tradePlans, analytics, baseAudits);
  const overall = performanceSlice("OVERALL", familyItems.filter((item) => item.analytics.dataIntegrity.safeForPerformance));
  const score = systemScore({ phase10, overall, family: familyPerformance, grades: initialGradePerformance, forward, analysis });
  const primaryFamilyResolved = Math.max(...familyPerformance.map((item) => item.resolved), 0);
  const gradeA = initialGradePerformance.find((item) => item.key === "A") ?? performanceSlice("A", []);
  const gradeB = initialGradePerformance.find((item) => item.key === "B") ?? performanceSlice("B", []);
  const ambiguityRate = overall.entered > 0 ? stable(overall.ambiguous / overall.entered * 100) : null;
  const gates = [
    gate("DATA_QUALITY_A_OR_B", phase10.officialPerformanceValid, phase10.dataIntegrityGrade, "A_DATA or B_DATA", true),
    gate("QML_ENGINE_DATA_READY", phase10.qmlDataReady, phase10.qmlDataReady, "true", true),
    gate("RESOLVED_TRADES_300", overall.resolved >= 300, overall.resolved, ">= 300", true),
    gate("PRIMARY_FAMILY_RESOLVED_100", primaryFamilyResolved >= 100, primaryFamilyResolved, ">= 100", true),
    gate("FORWARD_RESOLVED_50", forward.forward.resolved >= 50, forward.forward.resolved, ">= 50", true),
    gate("POSITIVE_EXPECTANCY", (overall.expectancyR ?? 0) > 0, overall.expectancyR, "> 0R", true),
    gate("PROFIT_FACTOR_1_2", (overall.profitFactorR ?? 0) >= 1.2, overall.profitFactorR, ">= 1.2", true),
    gate("FORWARD_POSITIVE", forward.positive && forward.sampleSufficient, forward.positive, "positive expectancy and PF >= 1.2 with 50+ resolved", true),
    gate("A_GRADE_OUTPERFORMS_B", gradeA.resolved >= 20 && gradeB.resolved >= 20 && (gradeA.expectancyR ?? -Infinity) > (gradeB.expectancyR ?? Infinity), `${gradeA.expectancyR ?? "N/A"} vs ${gradeB.expectancyR ?? "N/A"}`, "A expectancy > B expectancy with 20+ each", true),
    gate("AMBIGUITY_RATE_10", ambiguityRate !== null && ambiguityRate <= 10, ambiguityRate, "<= 10%", false),
    gate("MAX_DRAWDOWN_15R", overall.maximumDrawdownR <= 15, overall.maximumDrawdownR, "<= 15R", false),
  ];
  const liveReady = gates.filter((item) => item.requiredForLive).every((item) => item.passed);
  const systemVerdict = liveReady && score >= 85
    ? "LIVE_CANDIDATE"
    : score >= 70
      ? "PAPER_READY"
      : score >= 50
        ? "DEVELOPING"
        : "NOT_READY";

  const planAudits = baseAudits.map((audit, index): Phase11SignalAudit => {
    const evidenceScore = familyEvidenceScore(audit.family, familyPerformance, forward);
    const evidence = component(
      "STATISTICAL_EVIDENCE",
      evidenceScore,
      10,
      [
        `${audit.family} resolved sample: ${familyPerformance.find((item) => item.key === audit.family)?.resolved ?? 0}.`,
        `Forward resolved sample: ${forward.forward.resolved}.`,
      ],
      evidenceScore < 5 ? ["Strategy edge is not sufficiently validated on clean forward outcomes."] : [],
    );
    const deploymentPermission: Phase11DeploymentPermission = audit.hardVetoes.length > 0
      ? "BLOCKED"
      : audit.grade === "C"
        ? "RESEARCH_ONLY"
        : liveReady
          ? "LIVE_CANDIDATE"
          : "PAPER_TRADE";
    const suggestedRiskPercent = deploymentPermission === "LIVE_CANDIDATE"
      ? audit.grade === "A" ? 0.5 : audit.grade === "B" ? 0.25 : 0
      : 0;
    return {
      ...audit,
      evidenceScore,
      totalScore: stable(audit.technicalScore + evidenceScore),
      deploymentPermission,
      suggestedRiskPercent,
      components: [...audit.components, evidence],
      softWarnings: [...new Set([...audit.softWarnings, ...evidence.warnings])],
    };
  });

  const finalGradePerformance = gradePerformance(tradePlans, analytics, planAudits);
  const sessionItems = tradePlans.map((plan, index): PerformanceItem => ({
    key: planAudits[index].context.session,
    plan,
    analytics: analytics[index],
  }));
  const regimeItems = tradePlans.map((plan, index): PerformanceItem => ({
    key: planAudits[index].context.regime,
    plan,
    analytics: analytics[index],
  }));
  const vetoCounts: Record<string, number> = {};
  for (const audit of planAudits) {
    for (const code of audit.hardVetoes) vetoCounts[code] = (vetoCounts[code] ?? 0) + 1;
  }
  const diagnostics: string[] = [];
  if (!phase10.qmlDataReady) diagnostics.push("QML_ENGINE_NOT_DATA_READY");
  if (!phase10.officialPerformanceValid) diagnostics.push("OFFICIAL_PERFORMANCE_BLOCKED_BY_DATA_QUALITY");
  if (overall.resolved < 300) diagnostics.push("INSUFFICIENT_RESOLVED_SAMPLE");
  if (!forward.sampleSufficient) diagnostics.push("INSUFFICIENT_FORWARD_SAMPLE");
  if (!forward.positive) diagnostics.push("FORWARD_EDGE_NOT_PROVEN");
  if (!gates.find((item) => item.code === "A_GRADE_OUTPERFORMS_B")?.passed) diagnostics.push("A_GRADE_SUPERIORITY_NOT_PROVEN");
  diagnostics.push("MACRO_NEWS_FILTER_NOT_CONNECTED");
  diagnostics.push("TICK_LEVEL_INTRABAR_SEQUENCE_NOT_CONNECTED");

  const counts = { A: 0, B: 0, C: 0, BLOCKED: 0 };
  const permissions = { LIVE_CANDIDATE: 0, PAPER_TRADE: 0, RESEARCH_ONLY: 0, BLOCKED: 0 };
  for (const audit of planAudits) {
    counts[audit.grade] += 1;
    permissions[audit.deploymentPermission] += 1;
  }

  return {
    systemScore: score,
    systemVerdict,
    liveReady,
    technicalMaximumScore: TECHNICAL_MAX_SCORE,
    totalMaximumScore: TOTAL_MAX_SCORE,
    auditCounts: counts,
    permissionCounts: permissions,
    overallPerformance: overall,
    familyPerformance,
    sessionPerformance: groupPerformance(sessionItems, SESSIONS),
    regimePerformance: groupPerformance(regimeItems, REGIMES),
    gradePerformance: finalGradePerformance,
    forwardValidation: forward,
    gates,
    hardVetoCounts: vetoCounts,
    planAudits,
    diagnostics,
    semantics: "PHASE11_SCALPING_AUDIT_REQUIRES_FORWARD_VALIDATION_BEFORE_LIVE_USE",
  };
}
