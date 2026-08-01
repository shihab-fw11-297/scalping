import { FixedMinHeap } from "./fixed-min-heap";
import {
  analyzeMultiTimeframeStateAt,
  forEachMultiTimeframeState,
  getOrCreateMultiTimeframeStateIndex,
  type MultiTimeframeStateIndex,
} from "./multi-timeframe-state";
import { analyzePriceBehaviourWindow } from "./price-behaviour";
import type {
  CompactCandle,
  HypothesisDirection,
  HypothesisEvaluation,
  HypothesisEvidenceCode,
  HypothesisOpportunitySnapshot,
  HypothesisOpportunitySummary,
  HypothesisState,
  CompositeMarketState,
  MultiTimeframeStateEvent,
  MultiTimeframeStateSnapshot,
  MultiTimeframeStateSummary,
  OpportunityAvailability,
  OpportunityCandidate,
  OpportunityDirection,
  OpportunityEvidenceCode,
  OpportunityEvent,
  OpportunityFamily,
  OpportunityStage,
  PriceBehaviour,
  PriceDirection,
  Timeframe,
  TimeframeAlignment,
  TimeframeDataset,
} from "./types";
import type { DailyBoundaryMode } from "./market-session";

const MINUTE_MS = 60_000;
const EPSILON = 1e-9;

export const HYPOTHESIS_OPPORTUNITY_CONFIG = Object.freeze({
  leadingMinimumScore: 48,
  leadingMinimumGap: 6,
  matureCandidateMinimumScore: 70,
  developingMinimumScore: 48,
  watchMinimumScore: 28,
  strongestOpportunityLimit: 24,
});

const HYPOTHESIS_DIRECTIONS: readonly HypothesisDirection[] = [
  "BULLISH",
  "BEARISH",
  "RANGE",
];
const OPPORTUNITY_FAMILIES: readonly OpportunityFamily[] = [
  "PRESSURE_RELEASE",
  "FAILED_BREAK_REVERSAL",
  "IMPULSE_RELOAD",
  "TIMEFRAME_ROTATION",
];
const OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  "ABSENT",
  "WATCH",
  "DEVELOPING",
  "MATURE_CANDIDATE",
  "DEGRADED",
];

interface ScoreAccumulator<E extends string> {
  supportScore: number;
  contradictionScore: number;
  support: E[];
  contradictions: E[];
}

export interface HypothesisOpportunityIndex {
  stateIndex: MultiTimeframeStateIndex;
}

interface BuildOptions {
  dailyBoundaryMode: DailyBoundaryMode;
}

const indexCache = new WeakMap<object, HypothesisOpportunityIndex>();

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stable(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function uniquePush<T extends string>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

function addSupport<E extends string>(acc: ScoreAccumulator<E>, code: E, weight: number): void {
  acc.supportScore += weight;
  uniquePush(acc.support, code);
}

function addContradiction<E extends string>(
  acc: ScoreAccumulator<E>,
  code: E,
  weight: number,
): void {
  acc.contradictionScore += weight;
  uniquePush(acc.contradictions, code);
}

function directionMatches(value: PriceDirection, target: OpportunityDirection): boolean {
  return value === target;
}

function opposite(direction: OpportunityDirection): OpportunityDirection {
  return direction === "BULLISH" ? "BEARISH" : direction === "BEARISH" ? "BULLISH" : "NEUTRAL";
}

function hypothesisState(
  score: number,
  supportScore: number,
  contradictionScore: number,
): HypothesisState {
  if (supportScore >= 28 && contradictionScore >= supportScore * 0.78) return "CONFLICTED";
  if (score >= 62) return "ACTIVE";
  if (score >= 38) return "WEAK";
  return "DORMANT";
}

function finalHypothesis(
  direction: HypothesisDirection,
  acc: ScoreAccumulator<HypothesisEvidenceCode>,
): HypothesisEvaluation {
  const score = clamp(acc.supportScore - acc.contradictionScore * 0.82);
  return {
    direction,
    state: hypothesisState(score, acc.supportScore, acc.contradictionScore),
    score: stable(score),
    supportScore: stable(clamp(acc.supportScore)),
    contradictionScore: stable(clamp(acc.contradictionScore)),
    support: acc.support,
    contradictions: acc.contradictions,
  };
}

function evaluateDirectionalHypothesis(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
  direction: Exclude<HypothesisDirection, "RANGE">,
): HypothesisEvaluation {
  const acc: ScoreAccumulator<HypothesisEvidenceCode> = {
    supportScore: 0,
    contradictionScore: 0,
    support: [],
    contradictions: [],
  };
  const bearish = direction === "BEARISH";
  const dailyCode: HypothesisEvidenceCode = bearish ? "DAILY_BEARISH" : "DAILY_BULLISH";
  const campaignCode: HypothesisEvidenceCode = bearish ? "CAMPAIGN_BEARISH" : "CAMPAIGN_BULLISH";
  const hourlyCode: HypothesisEvidenceCode = bearish
    ? "HOURLY_BEARISH_LOCATION"
    : "HOURLY_BULLISH_LOCATION";
  const m15Code: HypothesisEvidenceCode = bearish
    ? "M15_BEARISH_PRESSURE"
    : "M15_BULLISH_PRESSURE";
  const m5Code: HypothesisEvidenceCode = bearish
    ? "M5_BEARISH_CONSTRUCTION"
    : "M5_BULLISH_CONSTRUCTION";
  const m1Code: HypothesisEvidenceCode = bearish
    ? "M1_BEARISH_EXECUTION"
    : "M1_BULLISH_EXECUTION";
  const momentumCode: HypothesisEvidenceCode = bearish ? "MOMENTUM_BEARISH" : "MOMENTUM_BULLISH";
  const acceptedCode: HypothesisEvidenceCode = bearish
    ? "BREAK_BEARISH_ACCEPTED"
    : "BREAK_BULLISH_ACCEPTED";
  const failedCode: HypothesisEvidenceCode = bearish
    ? "BREAK_BEARISH_FAILED"
    : "BREAK_BULLISH_FAILED";
  const targetDirection: PriceDirection = direction;
  const oppositeDirection: PriceDirection = bearish ? "BULLISH" : "BEARISH";

  if (snapshot.daily.direction === targetDirection) {
    addSupport(acc, dailyCode, 10 + snapshot.daily.strength * 0.06);
  } else if (snapshot.daily.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "DAILY_BULLISH" : "DAILY_BEARISH", 14);
  }

  if (snapshot.rolling5h.direction === targetDirection) {
    addSupport(acc, campaignCode, 12 + snapshot.rolling5h.strength * 0.07);
  } else if (snapshot.rolling5h.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "CAMPAIGN_BULLISH" : "CAMPAIGN_BEARISH", 17);
  }

  if (snapshot.hourly.direction === targetDirection) {
    addSupport(acc, hourlyCode, 7 + snapshot.hourly.locationQuality * 0.07);
  } else if (snapshot.hourly.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "HOURLY_BULLISH_LOCATION" : "HOURLY_BEARISH_LOCATION", 10);
  }

  if (snapshot.m15.direction === targetDirection) {
    addSupport(acc, m15Code, 8 + snapshot.m15.strength * 0.06);
  } else if (snapshot.m15.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "M15_BULLISH_PRESSURE" : "M15_BEARISH_PRESSURE", 13);
  }

  if (snapshot.m5.direction === targetDirection) {
    addSupport(acc, m5Code, 9 + snapshot.m5.constructionScore * 0.07);
  } else if (snapshot.m5.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "M5_BULLISH_CONSTRUCTION" : "M5_BEARISH_CONSTRUCTION", 14);
  }

  if (snapshot.m1.direction === targetDirection) {
    addSupport(acc, m1Code, 7 + snapshot.m1.intensity * 0.06);
  } else if (snapshot.m1.direction === oppositeDirection) {
    addContradiction(acc, bearish ? "M1_BULLISH_EXECUTION" : "M1_BEARISH_EXECUTION", 12);
  }

  if (snapshot.composite.direction === targetDirection) {
    addSupport(acc, snapshot.composite.alignment === "FRESH_ALIGNMENT" ? "FRESH_ALIGNMENT" : campaignCode, 10);
  } else if (snapshot.composite.direction === oppositeDirection) {
    addContradiction(acc, "DESTRUCTIVE_DISAGREEMENT", 10);
  }

  if (snapshot.composite.alignment === "FRESH_ALIGNMENT") addSupport(acc, "FRESH_ALIGNMENT", 8);
  if (snapshot.composite.alignment === "PRODUCTIVE_DISAGREEMENT") {
    addSupport(acc, "PRODUCTIVE_DISAGREEMENT", snapshot.composite.direction === targetDirection ? 7 : 3);
  }
  if (snapshot.composite.alignment === "DESTRUCTIVE_DISAGREEMENT") {
    addContradiction(acc, "DESTRUCTIVE_DISAGREEMENT", 15);
  }

  if (feature.momentumCondition.includes(direction)) addSupport(acc, momentumCode, 7);
  if (feature.momentumCondition.startsWith("DECAYING")) addContradiction(acc, "MOMENTUM_DECAY", 6);
  if (feature.breakState === `${direction}_ACCEPTED`) addSupport(acc, acceptedCode, 8);
  if (feature.breakState === `${direction}_FAILED`) addContradiction(acc, failedCode, 9);

  if (snapshot.composite.state === "NOISE") addContradiction(acc, "COMPOSITE_NOISE", 14);
  if (snapshot.m1.lateEntryRisk === "HIGH" || snapshot.m5.lateEntryRisk === "HIGH") {
    addContradiction(acc, "HIGH_LATE_ENTRY_RISK", 8);
  }
  if (snapshot.composite.availableLayers < 4) {
    addContradiction(acc, "PARTIAL_HIGHER_TIMEFRAME_DATA", 18);
  }

  return finalHypothesis(direction, acc);
}

function evaluateRangeHypothesis(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): HypothesisEvaluation {
  const acc: ScoreAccumulator<HypothesisEvidenceCode> = {
    supportScore: 0,
    contradictionScore: 0,
    support: [],
    contradictions: [],
  };

  if (["RANGE", "COMPRESSION", "TRANSITION"].includes(snapshot.daily.condition)) {
    addSupport(acc, "DAILY_RANGE_OR_COMPRESSION", 12);
  }
  if (["BALANCE", "COMPRESSION", "SESSION_REOPEN"].includes(snapshot.rolling5h.stage)) {
    addSupport(acc, "CAMPAIGN_BALANCED", 16);
  }
  if (snapshot.hourly.condition === "RANGE_LOCATION" || snapshot.hourly.zone === "MID_RANGE") {
    addSupport(acc, "HOURLY_RANGE_LOCATION", 13);
  }
  if (["COMPRESSION", "ROTATION", "BALANCED"].includes(snapshot.m15.state)) {
    addSupport(acc, "M15_ROTATION_OR_COMPRESSION", 14);
  }
  if (["IDLE", "COMPRESSION_BUILDING"].includes(snapshot.m5.state)) {
    addSupport(acc, "M5_RANGE_CONSTRUCTION", 13);
  }
  if (snapshot.m1.state === "CALM" || snapshot.m1.quality === "MIXED") {
    addSupport(acc, "M1_CALM_OR_MIXED", 8);
  }
  if (snapshot.composite.state === "RANGE") addSupport(acc, "COMPOSITE_RANGE", 14);
  if (snapshot.composite.state === "COMPRESSION") addSupport(acc, "COMPOSITE_COMPRESSION", 14);
  if (feature.phase === "COMPRESSION" || feature.phase === "BALANCED") {
    addSupport(acc, "M15_ROTATION_OR_COMPRESSION", 8);
  }

  if (["EXPANSION", "TREND_CONTINUATION"].includes(snapshot.composite.state)) {
    addContradiction(acc, snapshot.composite.direction === "BULLISH" ? "MOMENTUM_BULLISH" : "MOMENTUM_BEARISH", 18);
  }
  if (snapshot.composite.evidenceScore >= 65 && snapshot.composite.direction !== "NEUTRAL") {
    addContradiction(acc, snapshot.composite.direction === "BULLISH" ? "DAILY_BULLISH" : "DAILY_BEARISH", 12);
  }
  if (snapshot.composite.state === "NOISE" || feature.noiseScore >= 75) {
    addContradiction(acc, "COMPOSITE_NOISE", 13);
  }
  if (feature.breakState.endsWith("ACCEPTED")) {
    addContradiction(acc, feature.breakState.startsWith("BULLISH") ? "BREAK_BULLISH_ACCEPTED" : "BREAK_BEARISH_ACCEPTED", 10);
  }
  if (snapshot.composite.availableLayers < 4) {
    addContradiction(acc, "PARTIAL_HIGHER_TIMEFRAME_DATA", 14);
  }

  return finalHypothesis("RANGE", acc);
}

function rankHypotheses(
  bullish: HypothesisEvaluation,
  bearish: HypothesisEvaluation,
  range: HypothesisEvaluation,
): [HypothesisEvaluation, HypothesisEvaluation, HypothesisEvaluation] {
  const all: HypothesisEvaluation[] = [bullish, bearish, range];
  const ordered = [...all].sort((a, b) => b.score - a.score || HYPOTHESIS_DIRECTIONS.indexOf(a.direction) - HYPOTHESIS_DIRECTIONS.indexOf(b.direction));
  const top = ordered[0];
  const second = ordered[1];
  for (const item of all) {
    if (
      item === top &&
      item.score >= HYPOTHESIS_OPPORTUNITY_CONFIG.leadingMinimumScore &&
      item.score - second.score >= HYPOTHESIS_OPPORTUNITY_CONFIG.leadingMinimumGap &&
      item.state !== "CONFLICTED"
    ) item.state = "LEADING";
  }
  return [bullish, bearish, range];
}

function directionalStateDirection(state: string): OpportunityDirection {
  if (state.startsWith("BULLISH")) return "BULLISH";
  if (state.startsWith("BEARISH")) return "BEARISH";
  return "NEUTRAL";
}

function commonBlockers(
  snapshot: MultiTimeframeStateSnapshot,
  direction: OpportunityDirection,
  options: { allowCounterComposite?: boolean } = {},
): OpportunityEvidenceCode[] {
  const blockers: OpportunityEvidenceCode[] = [];
  if (
    snapshot.composite.state === "NOISE" ||
    snapshot.m15.state === "NOISY" ||
    snapshot.m5.state === "NOISY" ||
    snapshot.m1.state === "NOISY"
  ) uniquePush(blockers, "NOISY_MARKET");
  if (snapshot.composite.alignment === "DESTRUCTIVE_DISAGREEMENT") {
    uniquePush(blockers, "DESTRUCTIVE_TIMEFRAME_CONFLICT");
  }
  if (snapshot.composite.availableLayers < 4) uniquePush(blockers, "PARTIAL_DATA");
  if (snapshot.m1.lateEntryRisk === "HIGH" || snapshot.m5.lateEntryRisk === "HIGH") {
    uniquePush(blockers, "HIGH_LATE_ENTRY_RISK");
  }
  if (snapshot.m1.state === "EXTENDED" || snapshot.m5.state === "EXTENDED") {
    uniquePush(blockers, "EXTENDED_MOVE");
  }
  if (
    direction !== "NEUTRAL" &&
    snapshot.composite.direction !== "NEUTRAL" &&
    snapshot.composite.direction !== direction &&
    snapshot.composite.evidenceScore >= 58 &&
    !options.allowCounterComposite
  ) uniquePush(blockers, "DIRECTION_CONFLICT");
  return blockers;
}

function finalOpportunity(input: Omit<OpportunityCandidate, "score" | "stage"> & {
  rawScore: number;
  hasContext: boolean;
  hasDevelopment: boolean;
  hasTrigger: boolean;
}): OpportunityCandidate {
  const severe = input.blockers.some((item) =>
    item === "NOISY_MARKET" ||
    item === "DESTRUCTIVE_TIMEFRAME_CONFLICT" ||
    item === "PARTIAL_DATA" ||
    item === "DIRECTION_CONFLICT",
  );
  const penalty = input.blockers.reduce((sum, item) => {
    if (item === "NOISY_MARKET") return sum + 22;
    if (item === "DESTRUCTIVE_TIMEFRAME_CONFLICT") return sum + 20;
    if (item === "PARTIAL_DATA") return sum + 18;
    if (item === "DIRECTION_CONFLICT") return sum + 18;
    if (item === "HIGH_LATE_ENTRY_RISK") return sum + 14;
    if (item === "EXTENDED_MOVE") return sum + 12;
    if (item === "MISSING_TRIGGER") return sum + 8;
    return sum;
  }, 0);
  const score = clamp(input.rawScore - penalty);
  let stage: OpportunityStage = "ABSENT";
  if (input.hasContext && score >= HYPOTHESIS_OPPORTUNITY_CONFIG.watchMinimumScore) stage = "WATCH";
  if (input.hasDevelopment && score >= HYPOTHESIS_OPPORTUNITY_CONFIG.developingMinimumScore) {
    stage = "DEVELOPING";
  }
  if (
    input.hasTrigger &&
    input.hasDevelopment &&
    score >= HYPOTHESIS_OPPORTUNITY_CONFIG.matureCandidateMinimumScore &&
    !severe
  ) stage = "MATURE_CANDIDATE";
  else if (input.hasContext && score >= HYPOTHESIS_OPPORTUNITY_CONFIG.watchMinimumScore && severe) stage = "DEGRADED";

  return {
    family: input.family,
    direction: input.direction,
    stage,
    score: stable(score),
    contextScore: stable(clamp(input.contextScore)),
    developmentScore: stable(clamp(input.developmentScore)),
    triggerScore: stable(clamp(input.triggerScore)),
    freshnessScore: stable(clamp(input.freshnessScore)),
    evidence: input.evidence,
    blockers: input.blockers,
  };
}

function pressureRelease(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): OpportunityCandidate {
  const evidence: OpportunityEvidenceCode[] = [];
  let direction = directionalStateDirection(snapshot.m5.state);
  if (direction === "NEUTRAL") direction = directionalStateDirection(snapshot.m1.state);
  if (direction === "NEUTRAL" && snapshot.composite.direction !== "NEUTRAL") direction = snapshot.composite.direction;

  const compression =
    snapshot.composite.state === "COMPRESSION" ||
    snapshot.rolling5h.stage === "COMPRESSION" ||
    snapshot.m15.state === "COMPRESSION" ||
    snapshot.m5.state === "COMPRESSION_BUILDING" ||
    feature.phase === "COMPRESSION";
  const pressure =
    snapshot.m5.state.endsWith("PRESSURE") ||
    snapshot.m15.state.endsWith("PRESSURE") ||
    snapshot.m5.state.endsWith("BREAK_ATTEMPT") ||
    snapshot.m1.state.endsWith("BREAK_ATTEMPT") ||
    snapshot.m5.state.endsWith("ACCEPTANCE") ||
    snapshot.m1.state.endsWith("BREAK_ACCEPTED");
  const accepted =
    snapshot.m5.state.endsWith("ACCEPTANCE") ||
    snapshot.m1.state.endsWith("BREAK_ACCEPTED") ||
    feature.breakState.endsWith("ACCEPTED");

  let contextScore = 0;
  let developmentScore = 0;
  let triggerScore = 0;
  if (compression) { contextScore += 34; uniquePush(evidence, "COMPRESSION_CONTEXT"); }
  if (snapshot.composite.alignment !== "DESTRUCTIVE_DISAGREEMENT" && direction !== "NEUTRAL") {
    contextScore += 16; uniquePush(evidence, "HIGHER_TIMEFRAME_SUPPORT");
  }
  if (pressure) { developmentScore += 27; uniquePush(evidence, "DIRECTIONAL_PRESSURE"); }
  if (snapshot.m5.state.endsWith("BREAK_ATTEMPT") || snapshot.m1.state.endsWith("BREAK_ATTEMPT")) {
    developmentScore += 14; uniquePush(evidence, "BREAK_ATTEMPT");
  }
  if (accepted) { triggerScore += 32; uniquePush(evidence, "BREAK_ACCEPTED"); }
  if (feature.momentumCondition.startsWith("ACCELERATING")) {
    triggerScore += 14; uniquePush(evidence, "MOMENTUM_ACCELERATION");
  }
  if (snapshot.m1.quality === "CLEAN") { triggerScore += 8; uniquePush(evidence, "STRONG_EXECUTION"); }
  if (snapshot.m1.freshnessScore >= 60) uniquePush(evidence, "FRESH_EXECUTION");

  const blockers = commonBlockers(snapshot, direction);
  if (!accepted) uniquePush(blockers, "MISSING_TRIGGER");
  return finalOpportunity({
    family: "PRESSURE_RELEASE",
    direction,
    rawScore: contextScore + developmentScore + triggerScore,
    contextScore,
    developmentScore,
    triggerScore,
    freshnessScore: snapshot.m1.freshnessScore,
    evidence,
    blockers,
    hasContext: compression,
    hasDevelopment: pressure,
    hasTrigger: accepted,
  });
}

function failedBreakReversal(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): OpportunityCandidate {
  const evidence: OpportunityEvidenceCode[] = [];
  let direction: OpportunityDirection = "NEUTRAL";
  if (feature.breakState === "BULLISH_FAILED") direction = "BEARISH";
  else if (feature.breakState === "BEARISH_FAILED") direction = "BULLISH";
  else if (snapshot.m1.state === "FAILED_BREAK" || snapshot.m5.state === "FAILED_BREAK" || snapshot.m15.state === "FAILED_BREAK") {
    direction = snapshot.m1.direction !== "NEUTRAL" ? snapshot.m1.direction : opposite(snapshot.composite.direction);
  }

  const failed =
    feature.breakState.endsWith("FAILED") ||
    feature.breakState === "BOTH_SIDES_FAILED" ||
    snapshot.m1.state === "FAILED_BREAK" ||
    snapshot.m5.state === "FAILED_BREAK" ||
    snapshot.m15.state === "FAILED_BREAK";
  const breakAttempt =
    feature.breakState.endsWith("ATTEMPT") ||
    snapshot.m1.state.endsWith("BREAK_ATTEMPT") ||
    snapshot.m5.state.endsWith("BREAK_ATTEMPT");
  const recovery =
    direction !== "NEUTRAL" &&
    (
      directionMatches(feature.impulseDirection, direction) ||
      feature.phase === `${direction}_RECOVERY` ||
      feature.momentumCondition === `ACCELERATING_${direction}` ||
      snapshot.m1.direction === direction
    );
  const rangeEdge = ["RANGE_HIGH", "RANGE_LOW", "ABOVE_RANGE", "BELOW_RANGE"].includes(snapshot.hourly.zone);

  let contextScore = 0;
  let developmentScore = 0;
  let triggerScore = 0;
  if (rangeEdge) { contextScore += 22; uniquePush(evidence, "RANGE_EDGE_CONTEXT"); }
  if (snapshot.hourly.locationQuality >= 55) {
    contextScore += 12; uniquePush(evidence, "FAVOURABLE_HOURLY_LOCATION");
  }
  if (failed) { developmentScore += 35; uniquePush(evidence, "BREAK_FAILED"); }
  if (recovery) { triggerScore += 30; uniquePush(evidence, "OPPOSITE_RECOVERY"); }
  if (feature.momentumCondition.startsWith("ACCELERATING")) {
    triggerScore += 12; uniquePush(evidence, "MOMENTUM_ACCELERATION");
  }
  if (snapshot.m1.quality === "CLEAN") { triggerScore += 8; uniquePush(evidence, "STRONG_EXECUTION"); }

  const blockers = commonBlockers(snapshot, direction, { allowCounterComposite: true });
  if (!recovery) uniquePush(blockers, "MISSING_TRIGGER");
  return finalOpportunity({
    family: "FAILED_BREAK_REVERSAL",
    direction,
    rawScore: contextScore + developmentScore + triggerScore,
    contextScore,
    developmentScore,
    triggerScore,
    freshnessScore: snapshot.m1.freshnessScore,
    evidence,
    blockers,
    hasContext: failed || (rangeEdge && breakAttempt),
    hasDevelopment: failed,
    hasTrigger: recovery,
  });
}

function impulseReload(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): OpportunityCandidate {
  const evidence: OpportunityEvidenceCode[] = [];
  let direction: OpportunityDirection = snapshot.rolling5h.direction;
  if (direction === "NEUTRAL") direction = snapshot.daily.direction;
  if (direction === "NEUTRAL") direction = snapshot.composite.direction;

  const higherSupport =
    direction !== "NEUTRAL" &&
    [snapshot.daily.direction, snapshot.rolling5h.direction, snapshot.composite.direction]
      .filter((item) => item === direction).length >= 2;
  const pullback =
    snapshot.m5.state === `${direction}_PULLBACK` ||
    feature.phase === `${direction}_PULLBACK` ||
    snapshot.rolling5h.stage === `${direction}_PULLBACK`;
  const controlledPullback =
    pullback &&
    feature.pullbackDepthPercent !== null &&
    feature.pullbackDepthPercent >= 8 &&
    feature.pullbackDepthPercent <= 68 &&
    feature.noiseScore < 70;
  const recovery =
    snapshot.m5.state === `${direction}_RECOVERY` ||
    snapshot.m1.state === `${direction}_RECOVERY` ||
    snapshot.m1.state === `${direction}_CONTINUATION` ||
    feature.phase === `${direction}_RECOVERY`;

  let contextScore = 0;
  let developmentScore = 0;
  let triggerScore = 0;
  if (higherSupport) { contextScore += 34; uniquePush(evidence, "HIGHER_TIMEFRAME_SUPPORT"); }
  if (snapshot.hourly.locationQuality >= 50) {
    contextScore += 12; uniquePush(evidence, "FAVOURABLE_HOURLY_LOCATION");
  }
  if (controlledPullback) { developmentScore += 31; uniquePush(evidence, "CONTROLLED_PULLBACK"); }
  else if (pullback) { developmentScore += 18; uniquePush(evidence, "CONTROLLED_PULLBACK"); }
  if (recovery) { triggerScore += 31; uniquePush(evidence, "RECOVERY_CONFIRMED"); }
  if (feature.recoverySpeedRatio !== null && feature.recoverySpeedRatio >= 1.15) {
    triggerScore += 10; uniquePush(evidence, "MOMENTUM_ACCELERATION");
  }
  if (snapshot.m1.freshnessScore >= 55) uniquePush(evidence, "FRESH_EXECUTION");

  const blockers = commonBlockers(snapshot, direction);
  if (!recovery) uniquePush(blockers, "MISSING_TRIGGER");
  return finalOpportunity({
    family: "IMPULSE_RELOAD",
    direction,
    rawScore: contextScore + developmentScore + triggerScore,
    contextScore,
    developmentScore,
    triggerScore,
    freshnessScore: Math.max(snapshot.m1.freshnessScore, feature.freshnessScore),
    evidence,
    blockers,
    hasContext: higherSupport && (pullback || recovery),
    hasDevelopment: pullback,
    hasTrigger: recovery,
  });
}

function timeframeRotation(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): OpportunityCandidate {
  const evidence: OpportunityEvidenceCode[] = [];
  let direction: OpportunityDirection = "NEUTRAL";
  if (snapshot.daily.direction !== "NEUTRAL" && snapshot.daily.direction === snapshot.rolling5h.direction) {
    direction = snapshot.daily.direction;
  } else if (snapshot.rolling5h.direction !== "NEUTRAL") direction = snapshot.rolling5h.direction;
  else direction = snapshot.composite.direction;

  const productive =
    snapshot.composite.alignment === "PRODUCTIVE_DISAGREEMENT" ||
    snapshot.composite.state === "ROTATION" ||
    snapshot.composite.state === "CORRECTION";
  const lowerRotation =
    direction !== "NEUTRAL" &&
    (
      snapshot.m15.state === "ROTATION" ||
      snapshot.m5.state === `${direction}_RECOVERY` ||
      snapshot.m1.state === `${direction}_RECOVERY` ||
      snapshot.m1.state === `${direction}_IGNITION` ||
      feature.momentumCondition === `ACCELERATING_${direction}`
    );
  const higherSupport =
    direction !== "NEUTRAL" &&
    (snapshot.daily.direction === direction || snapshot.rolling5h.direction === direction);

  let contextScore = 0;
  let developmentScore = 0;
  let triggerScore = 0;
  if (productive) { contextScore += 30; uniquePush(evidence, "PRODUCTIVE_TIMEFRAME_DISAGREEMENT"); }
  if (higherSupport) { contextScore += 22; uniquePush(evidence, "HIGHER_TIMEFRAME_SUPPORT"); }
  if (lowerRotation) { developmentScore += 29; uniquePush(evidence, "LOWER_TIMEFRAME_ROTATION"); }
  if (snapshot.m1.direction === direction && snapshot.m1.quality === "CLEAN") {
    triggerScore += 24; uniquePush(evidence, "STRONG_EXECUTION");
  }
  if (feature.momentumCondition === `ACCELERATING_${direction}`) {
    triggerScore += 12; uniquePush(evidence, "MOMENTUM_ACCELERATION");
  }
  if (snapshot.m1.freshnessScore >= 55) uniquePush(evidence, "FRESH_EXECUTION");

  const blockers = commonBlockers(snapshot, direction, { allowCounterComposite: true });
  const hasTrigger = lowerRotation && snapshot.m1.direction === direction;
  if (!hasTrigger) uniquePush(blockers, "MISSING_TRIGGER");
  return finalOpportunity({
    family: "TIMEFRAME_ROTATION",
    direction,
    rawScore: contextScore + developmentScore + triggerScore,
    contextScore,
    developmentScore,
    triggerScore,
    freshnessScore: snapshot.m1.freshnessScore,
    evidence,
    blockers,
    hasContext: productive,
    hasDevelopment: productive && lowerRotation,
    hasTrigger,
  });
}

function opportunityStageRank(stage: OpportunityStage): number {
  if (stage === "MATURE_CANDIDATE") return 5;
  if (stage === "DEVELOPING") return 4;
  if (stage === "WATCH") return 3;
  if (stage === "DEGRADED") return 2;
  return 1;
}

function availabilityFrom(opportunities: readonly OpportunityCandidate[]): OpportunityAvailability {
  if (opportunities.some((item) => item.stage === "MATURE_CANDIDATE")) return "CANDIDATE";
  if (opportunities.some((item) => item.stage === "WATCH" || item.stage === "DEVELOPING")) return "WATCH";
  return "NONE";
}

export function evaluateHypothesesAndOpportunities(
  snapshot: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): HypothesisOpportunitySnapshot {
  const hypotheses = rankHypotheses(
    evaluateDirectionalHypothesis(snapshot, feature, "BULLISH"),
    evaluateDirectionalHypothesis(snapshot, feature, "BEARISH"),
    evaluateRangeHypothesis(snapshot, feature),
  );
  const rankedHypotheses = [...hypotheses].sort((a, b) => b.score - a.score);
  const opportunities = [
    pressureRelease(snapshot, feature),
    failedBreakReversal(snapshot, feature),
    impulseReload(snapshot, feature),
    timeframeRotation(snapshot, feature),
  ].sort((a, b) =>
    opportunityStageRank(b.stage) - opportunityStageRank(a.stage) ||
    b.score - a.score ||
    OPPORTUNITY_FAMILIES.indexOf(a.family) - OPPORTUNITY_FAMILIES.indexOf(b.family),
  );
  const bestOpportunity = opportunities.find((item) => item.stage !== "ABSENT") ?? null;

  return {
    timestampMs: snapshot.timestampMs,
    hypotheses,
    leadingHypothesis: rankedHypotheses[0].direction,
    leadingHypothesisScore: rankedHypotheses[0].score,
    opportunityAvailability: availabilityFrom(opportunities),
    opportunities,
    bestOpportunity,
  };
}

function m1IndexAtOrBefore(candles: readonly CompactCandle[], anchorTimestampMs: number): number {
  let low = 0;
  let high = candles.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] + MINUTE_MS <= anchorTimestampMs) {
      match = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return match;
}

export function createHypothesisOpportunityIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: BuildOptions,
): HypothesisOpportunityIndex {
  return {
    stateIndex: getOrCreateMultiTimeframeStateIndex(datasets, options),
  };
}

export function getOrCreateHypothesisOpportunityIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: BuildOptions,
): HypothesisOpportunityIndex {
  const cached = indexCache.get(datasets);
  if (cached && cached.stateIndex.dailyBoundaryMode === options.dailyBoundaryMode) return cached;
  const created = createHypothesisOpportunityIndex(datasets, options);
  indexCache.set(datasets, created);
  return created;
}

export function analyzeHypothesesAndOpportunitiesAt(
  index: HypothesisOpportunityIndex,
  anchorTimestampMs: number,
): HypothesisOpportunitySnapshot | null {
  const state = analyzeMultiTimeframeStateAt(index.stateIndex, anchorTimestampMs);
  if (!state) return null;
  const m1Candles = index.stateIndex.datasets.M1.candles;
  const candleIndex = m1IndexAtOrBefore(m1Candles, state.timestampMs);
  if (candleIndex < 0) return null;
  const feature = analyzePriceBehaviourWindow(m1Candles, candleIndex, 1)[0];
  return feature ? evaluateHypothesesAndOpportunities(state, feature) : null;
}

function createCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

export function summarizeHypothesesAndOpportunities(
  index: HypothesisOpportunityIndex,
  strongestLimit = HYPOTHESIS_OPPORTUNITY_CONFIG.strongestOpportunityLimit,
): { summary: HypothesisOpportunitySummary; latest: HypothesisOpportunitySnapshot | null } {
  const leadingHypothesisCounts = createCountRecord(HYPOTHESIS_DIRECTIONS);
  const opportunityStageCounts = createCountRecord(OPPORTUNITY_STAGES);
  const opportunityFamilyCounts = createCountRecord(OPPORTUNITY_FAMILIES);
  const strongest = new FixedMinHeap<OpportunityEvent>(strongestLimit, (item) => item.score);
  let sampleCount = 0;
  let matureCandidateCount = 0;
  let leadingScoreTotal = 0;
  let bestScoreTotal = 0;
  let bestScoreSamples = 0;
  let latest: HypothesisOpportunitySnapshot | null = null;

  forEachMultiTimeframeState(index.stateIndex, (state, feature) => {
    const result = evaluateHypothesesAndOpportunities(state, feature);
    latest = result;
    sampleCount += 1;
    leadingScoreTotal += result.leadingHypothesisScore;
    leadingHypothesisCounts[result.leadingHypothesis] += 1;
    for (const opportunity of result.opportunities) {
      opportunityStageCounts[opportunity.stage] += 1;
      if (opportunity.stage !== "ABSENT") opportunityFamilyCounts[opportunity.family] += 1;
      if (opportunity.stage === "MATURE_CANDIDATE") {
        matureCandidateCount += 1;
        strongest.push({
          timestampMs: result.timestampMs,
          family: opportunity.family,
          direction: opportunity.direction,
          stage: opportunity.stage,
          score: opportunity.score,
        });
      }
    }
    if (result.bestOpportunity) {
      bestScoreTotal += result.bestOpportunity.score;
      bestScoreSamples += 1;
    }
  });

  return {
    summary: {
      sampleCount,
      leadingHypothesisCounts,
      opportunityStageCounts,
      opportunityFamilyCounts,
      matureCandidateCount,
      averageLeadingHypothesisScore: sampleCount > 0 ? stable(leadingScoreTotal / sampleCount) : 0,
      averageBestOpportunityScore: bestScoreSamples > 0 ? stable(bestScoreTotal / bestScoreSamples) : 0,
      strongestOpportunities: strongest.toDescendingArray(),
    },
    latest,
  };
}


const COMPOSITE_STATES: readonly CompositeMarketState[] = [
  "TREND_CONTINUATION", "CORRECTION", "ROTATION", "EXPANSION", "COMPRESSION",
  "RANGE", "NOISE", "TRANSITION", "INSUFFICIENT_DATA",
];
const ALIGNMENTS: readonly TimeframeAlignment[] = [
  "FRESH_ALIGNMENT", "MATURE_ALIGNMENT", "PRODUCTIVE_DISAGREEMENT",
  "DESTRUCTIVE_DISAGREEMENT", "MIXED", "NEUTRAL", "INSUFFICIENT_DATA",
];
const PRICE_DIRECTIONS: readonly PriceDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];

export function summarizeMarketStateAndOpportunities(
  index: HypothesisOpportunityIndex,
  strongestStateLimit = 24,
  strongestOpportunityLimit = HYPOTHESIS_OPPORTUNITY_CONFIG.strongestOpportunityLimit,
): {
  marketState: { summary: MultiTimeframeStateSummary; latest: MultiTimeframeStateSnapshot | null };
  hypothesisOpportunity: { summary: HypothesisOpportunitySummary; latest: HypothesisOpportunitySnapshot | null };
} {
  const directionCounts = createCountRecord(PRICE_DIRECTIONS);
  const alignmentCounts = createCountRecord(ALIGNMENTS);
  const stateCounts = createCountRecord(COMPOSITE_STATES);
  const strongestStates = new FixedMinHeap<MultiTimeframeStateEvent>(
    strongestStateLimit,
    (item) => item.evidenceScore,
  );

  const leadingHypothesisCounts = createCountRecord(HYPOTHESIS_DIRECTIONS);
  const opportunityStageCounts = createCountRecord(OPPORTUNITY_STAGES);
  const opportunityFamilyCounts = createCountRecord(OPPORTUNITY_FAMILIES);
  const strongestOpportunities = new FixedMinHeap<OpportunityEvent>(
    strongestOpportunityLimit,
    (item) => item.score,
  );

  let sampleCount = 0;
  let evidenceTotal = 0;
  let leadingScoreTotal = 0;
  let bestScoreTotal = 0;
  let bestScoreSamples = 0;
  let matureCandidateCount = 0;
  let latestState: MultiTimeframeStateSnapshot | null = null;
  let latestOpportunity: HypothesisOpportunitySnapshot | null = null;

  forEachMultiTimeframeState(index.stateIndex, (state, feature) => {
    latestState = state;
    sampleCount += 1;
    evidenceTotal += state.composite.evidenceScore;
    directionCounts[state.composite.direction] += 1;
    alignmentCounts[state.composite.alignment] += 1;
    stateCounts[state.composite.state] += 1;
    if (state.composite.evidenceScore >= 55) {
      strongestStates.push({
        timestampMs: state.timestampMs,
        direction: state.composite.direction,
        alignment: state.composite.alignment,
        state: state.composite.state,
        evidenceScore: state.composite.evidenceScore,
      });
    }

    const opportunity = evaluateHypothesesAndOpportunities(state, feature);
    latestOpportunity = opportunity;
    leadingScoreTotal += opportunity.leadingHypothesisScore;
    leadingHypothesisCounts[opportunity.leadingHypothesis] += 1;
    for (const item of opportunity.opportunities) {
      opportunityStageCounts[item.stage] += 1;
      if (item.stage !== "ABSENT") opportunityFamilyCounts[item.family] += 1;
      if (item.stage === "MATURE_CANDIDATE") {
        matureCandidateCount += 1;
        strongestOpportunities.push({
          timestampMs: opportunity.timestampMs,
          family: item.family,
          direction: item.direction,
          stage: item.stage,
          score: item.score,
        });
      }
    }
    if (opportunity.bestOpportunity) {
      bestScoreTotal += opportunity.bestOpportunity.score;
      bestScoreSamples += 1;
    }
  });

  return {
    marketState: {
      summary: {
        sampleCount,
        directionCounts,
        alignmentCounts,
        stateCounts,
        averageEvidenceScore: sampleCount > 0 ? stable(evidenceTotal / sampleCount) : 0,
        strongestEvents: strongestStates.toDescendingArray(),
      },
      latest: latestState,
    },
    hypothesisOpportunity: {
      summary: {
        sampleCount,
        leadingHypothesisCounts,
        opportunityStageCounts,
        opportunityFamilyCounts,
        matureCandidateCount,
        averageLeadingHypothesisScore: sampleCount > 0 ? stable(leadingScoreTotal / sampleCount) : 0,
        averageBestOpportunityScore: bestScoreSamples > 0 ? stable(bestScoreTotal / bestScoreSamples) : 0,
        strongestOpportunities: strongestOpportunities.toDescendingArray(),
      },
      latest: latestOpportunity,
    },
  };
}
