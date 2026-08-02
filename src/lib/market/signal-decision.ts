import { FixedMinHeap } from "./fixed-min-heap";
import {
  evaluateHypothesesAndOpportunities,
  type HypothesisOpportunityIndex,
} from "./hypothesis-opportunity";
import {
  analyzeMultiTimeframeStateAt,
  forEachMultiTimeframeState,
  getOrCreateMultiTimeframeStateIndex,
  type MultiTimeframeStateIndex,
} from "./multi-timeframe-state";
import { getNextDailyBucketStart, type DailyBoundaryMode } from "./market-session";
import { TIMEFRAME_MS } from "./constants";
import { analyzePriceBehaviourWindow } from "./price-behaviour";
import {
  getOrCreateSessionLiquidityIndex,
  sessionLiquidityAtIndex,
  type SessionLiquidityIndex,
} from "./session-liquidity";
import type {
  ChartSignalMarker,
  CompactCandle,
  CompositeMarketState,
  HypothesisDirection,
  HypothesisOpportunitySnapshot,
  HypothesisOpportunitySummary,
  MultiTimeframeStateEvent,
  MultiTimeframeStateSnapshot,
  MultiTimeframeStateSummary,
  NoTradeReasonCode,
  OpportunityCandidate,
  OpportunityDirection,
  OpportunityEvidenceCode,
  OpportunityEvent,
  OpportunityFamily,
  OpportunityStage,
  PriceBehaviour,
  PriceDirection,
  SignalAction,
  SignalDecisionEvent,
  SignalDecisionHistoryItem,
  SignalDecisionHistoryResponse,
  SignalDecisionReasonCode,
  SignalDecisionSnapshot,
  SignalDecisionSummary,
  SignalLifecycleState,
  SignalTrackSnapshot,
  Timeframe,
  TimeframeAlignment,
  TimeframeDataset,
} from "./types";

const MINUTE_MS = 60_000;
const NONE_INDEX = -1;

export const SIGNAL_DECISION_CONFIG = Object.freeze({
  watchExpiryBars: 12,
  armedExpiryBars: 7,
  candidateGraceBars: 1,
  minimumWatchPersistenceBars: 1,
  armMinimumScore: 52,
  armRetentionScore: 44,
  fastArmScore: 68,
  confirmationMinimumScore: 70,
  confirmationMinimumHypothesisScore: 40,
  confirmationMaximumHypothesisGap: 12,
  fastTrackScore: 86,
  fastTrackTriggerScore: 30,
  fastTrackFreshnessScore: 65,
  duplicateCooldownBars: 5,
  continuationMinimumSeparationBars: 3,
  continuationLookbackBars: 60,
  strongestSignalLimit: 30,
});

export const SIGNAL_OPPORTUNITY_FAMILIES: readonly OpportunityFamily[] = [
  "PRESSURE_RELEASE",
  "FAILED_BREAK_REVERSAL",
  "IMPULSE_RELOAD",
  "TIMEFRAME_ROTATION",
  "SESSION_LIQUIDITY_QML",
];
const LIFECYCLES: readonly SignalLifecycleState[] = [
  "OBSERVING",
  "WATCH",
  "ARMED",
  "CONFIRMED",
  "CONTINUATION",
  "INVALIDATED",
  "NO_TRADE",
];
const ACTIONS: readonly SignalAction[] = ["BUY", "SELL", "NONE"];
const NO_TRADE_REASONS: readonly NoTradeReasonCode[] = [
  "NO_OPPORTUNITY",
  "PARTIAL_DATA",
  "NOISY_MARKET",
  "DESTRUCTIVE_TIMEFRAME_CONFLICT",
  "LATE_ENTRY",
  "EXTENDED_MOVE",
  "DIRECTION_CONFLICT",
  "MISSING_TRIGGER",
  "COOLDOWN",
  "AMBIGUOUS_HYPOTHESES",
];
const HYPOTHESIS_DIRECTIONS: readonly HypothesisDirection[] = [
  "BULLISH",
  "BEARISH",
  "RANGE",
];
const OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  "ABSENT",
  "WATCH",
  "DEVELOPING",
  "MATURE_CANDIDATE",
  "DEGRADED",
];
const COMPOSITE_STATES: readonly CompositeMarketState[] = [
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
const ALIGNMENTS: readonly TimeframeAlignment[] = [
  "FRESH_ALIGNMENT",
  "MATURE_ALIGNMENT",
  "PRODUCTIVE_DISAGREEMENT",
  "DESTRUCTIVE_DISAGREEMENT",
  "MIXED",
  "NEUTRAL",
  "INSUFFICIENT_DATA",
];
const PRICE_DIRECTIONS: readonly PriceDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];

const REASON_CODES: readonly SignalDecisionReasonCode[] = [
  "OPPORTUNITY_OBSERVED",
  "DEVELOPMENT_PERSISTED",
  "MATURE_CANDIDATE",
  "HYPOTHESIS_ALIGNED",
  "REVERSAL_OR_ROTATION_EXCEPTION",
  "CLEAN_EXECUTION",
  "FRESH_TRIGGER",
  "FAST_TRACK_CONFIRMATION",
  "CONFIRMATION_PERSISTED",
  "CONTINUATION_AFTER_PULLBACK",
  "DUPLICATE_SUPPRESSED",
  "CANDIDATE_GRACE_PERIOD",
  "CANDIDATE_EXPIRED",
  "CANDIDATE_DEGRADED",
  "DIRECTION_FLIPPED",
  "HYPOTHESIS_INVALIDATED",
  "NOISY_OR_PARTIAL_DATA",
  "LATE_OR_EXTENDED",
  "TRIGGER_INCOMPLETE",
  "COOLDOWN_ACTIVE",
  "NO_QUALIFIED_OPPORTUNITY",
];

const REASON_BIT = new Map<SignalDecisionReasonCode, number>(
  REASON_CODES.map((value, index) => [value, 1 << index]),
);
const NO_TRADE_BIT = new Map<NoTradeReasonCode, number>(
  NO_TRADE_REASONS.map((value, index) => [value, 1 << index]),
);

const LIFECYCLE_CODE: Record<SignalLifecycleState, number> = {
  OBSERVING: 0,
  WATCH: 1,
  ARMED: 2,
  CONFIRMED: 3,
  CONTINUATION: 4,
  INVALIDATED: 5,
  NO_TRADE: 6,
};
const CODE_LIFECYCLE: readonly SignalLifecycleState[] = LIFECYCLES;
const DIRECTION_CODE: Record<OpportunityDirection, number> = {
  NEUTRAL: 0,
  BULLISH: 1,
  BEARISH: 2,
};
const CODE_DIRECTION: readonly OpportunityDirection[] = ["NEUTRAL", "BULLISH", "BEARISH"];
const STAGE_CODE: Record<OpportunityStage, number> = {
  ABSENT: 0,
  WATCH: 1,
  DEVELOPING: 2,
  MATURE_CANDIDATE: 3,
  DEGRADED: 4,
};
const CODE_STAGE: readonly OpportunityStage[] = OPPORTUNITY_STAGES;

interface BuildOptions {
  dailyBoundaryMode: DailyBoundaryMode;
}

interface TrackRuntime {
  state: SignalLifecycleState;
  direction: OpportunityDirection;
  episodeStartIndex: number;
  watchIndex: number;
  armedIndex: number;
  confirmedIndex: number;
  lastActiveIndex: number;
  expiryIndex: number;
  cooldownUntilIndex: number;
  bestScore: number;
}

interface TrackDecision {
  state: SignalLifecycleState;
  direction: OpportunityDirection;
  episodeStartIndex: number;
  watchIndex: number;
  armedIndex: number;
  confirmedIndex: number;
  expiryIndex: number;
  score: number;
  reasonMask: number;
  noTradeMask: number;
  isNewEvent: boolean;
  duplicateSuppressed: boolean;
  expired: boolean;
}

interface SignalArrays {
  state: Uint8Array;
  direction: Uint8Array;
  candidateStage: Uint8Array;
  candidateScore: Uint8Array;
  episodeStartIndex: Int32Array;
  watchIndex: Int32Array;
  armedIndex: Int32Array;
  confirmedIndex: Int32Array;
  expiryIndex: Int32Array;
  reasonMask: Uint32Array;
  noTradeMask: Uint16Array;
  eventFlag: Uint8Array;
  referencePrice: Float64Array;
  primaryFamily: Int8Array;
  primaryState: Uint8Array;
}

export interface SignalDecisionIndex {
  stateIndex: MultiTimeframeStateIndex;
  sessionLiquidityIndex: SessionLiquidityIndex;
  arrays: SignalArrays;
  summary: SignalDecisionSummary;
  latest: SignalDecisionSnapshot | null;
  marketStateSummary: MultiTimeframeStateSummary;
  latestMarketState: MultiTimeframeStateSnapshot | null;
  hypothesisOpportunitySummary: HypothesisOpportunitySummary;
  latestHypothesisOpportunity: HypothesisOpportunitySnapshot | null;
  eventSlots: Int32Array;
}

const indexCache = new WeakMap<object, SignalDecisionIndex>();

function createCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function stable(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function familySlot(candleIndex: number, familyIndex: number): number {
  return candleIndex * SIGNAL_OPPORTUNITY_FAMILIES.length + familyIndex;
}

function addReason(mask: number, code: SignalDecisionReasonCode): number {
  return mask | (REASON_BIT.get(code) ?? 0);
}

function addNoTrade(mask: number, code: NoTradeReasonCode): number {
  return mask | (NO_TRADE_BIT.get(code) ?? 0);
}

function decodeReasons(mask: number): SignalDecisionReasonCode[] {
  return REASON_CODES.filter((code) => (mask & (REASON_BIT.get(code) ?? 0)) !== 0);
}

function decodeNoTrade(mask: number): NoTradeReasonCode[] {
  return NO_TRADE_REASONS.filter((code) => (mask & (NO_TRADE_BIT.get(code) ?? 0)) !== 0);
}

function actionFor(
  lifecycle: SignalLifecycleState,
  direction: OpportunityDirection,
): SignalAction {
  if (lifecycle !== "CONFIRMED" && lifecycle !== "CONTINUATION") return "NONE";
  if (direction === "BULLISH") return "BUY";
  if (direction === "BEARISH") return "SELL";
  return "NONE";
}

function isActive(state: SignalLifecycleState): boolean {
  return state === "WATCH" || state === "ARMED" || state === "CONFIRMED" || state === "CONTINUATION";
}

function isConfirmation(state: SignalLifecycleState): boolean {
  return state === "CONFIRMED" || state === "CONTINUATION";
}

function resetRuntime(runtime: TrackRuntime): void {
  runtime.state = "OBSERVING";
  runtime.direction = "NEUTRAL";
  runtime.episodeStartIndex = NONE_INDEX;
  runtime.watchIndex = NONE_INDEX;
  runtime.armedIndex = NONE_INDEX;
  runtime.confirmedIndex = NONE_INDEX;
  runtime.lastActiveIndex = NONE_INDEX;
  runtime.expiryIndex = NONE_INDEX;
  runtime.bestScore = 0;
}

function newRuntime(): TrackRuntime {
  return {
    state: "OBSERVING",
    direction: "NEUTRAL",
    episodeStartIndex: NONE_INDEX,
    watchIndex: NONE_INDEX,
    armedIndex: NONE_INDEX,
    confirmedIndex: NONE_INDEX,
    lastActiveIndex: NONE_INDEX,
    expiryIndex: NONE_INDEX,
    cooldownUntilIndex: NONE_INDEX,
    bestScore: 0,
  };
}

function opportunityByFamily(
  snapshot: HypothesisOpportunitySnapshot,
  family: OpportunityFamily,
): OpportunityCandidate {
  const candidate = snapshot.opportunities.find((item) => item.family === family);
  if (!candidate) {
    return {
      family,
      direction: "NEUTRAL",
      stage: "ABSENT",
      score: 0,
      contextScore: 0,
      developmentScore: 0,
      triggerScore: 0,
      freshnessScore: 0,
      evidence: [],
      blockers: [],
    };
  }
  return candidate;
}

function hypothesisScore(
  snapshot: HypothesisOpportunitySnapshot,
  direction: OpportunityDirection,
): number {
  if (direction === "NEUTRAL") return 0;
  return snapshot.hypotheses.find((item) => item.direction === direction)?.score ?? 0;
}

function oppositeHypothesisScore(
  snapshot: HypothesisOpportunitySnapshot,
  direction: OpportunityDirection,
): number {
  if (direction === "BULLISH") {
    return snapshot.hypotheses.find((item) => item.direction === "BEARISH")?.score ?? 0;
  }
  if (direction === "BEARISH") {
    return snapshot.hypotheses.find((item) => item.direction === "BULLISH")?.score ?? 0;
  }
  return 0;
}

function noTradeMaskFromCandidate(candidate: OpportunityCandidate): number {
  let mask = 0;
  for (const blocker of candidate.blockers) {
    if (blocker === "PARTIAL_DATA") mask = addNoTrade(mask, "PARTIAL_DATA");
    else if (blocker === "NOISY_MARKET") mask = addNoTrade(mask, "NOISY_MARKET");
    else if (blocker === "DESTRUCTIVE_TIMEFRAME_CONFLICT") {
      mask = addNoTrade(mask, "DESTRUCTIVE_TIMEFRAME_CONFLICT");
    } else if (blocker === "HIGH_LATE_ENTRY_RISK") mask = addNoTrade(mask, "LATE_ENTRY");
    else if (blocker === "EXTENDED_MOVE") mask = addNoTrade(mask, "EXTENDED_MOVE");
    else if (blocker === "DIRECTION_CONFLICT") mask = addNoTrade(mask, "DIRECTION_CONFLICT");
    else if (blocker === "MISSING_TRIGGER") mask = addNoTrade(mask, "MISSING_TRIGGER");
  }
  return mask;
}

function hasSevereBlocker(candidate: OpportunityCandidate): boolean {
  return candidate.blockers.some((blocker) =>
    blocker === "PARTIAL_DATA" ||
    blocker === "NOISY_MARKET" ||
    blocker === "DESTRUCTIVE_TIMEFRAME_CONFLICT" ||
    blocker === "DIRECTION_CONFLICT",
  );
}

function hasLateBlocker(candidate: OpportunityCandidate): boolean {
  return candidate.blockers.includes("HIGH_LATE_ENTRY_RISK") || candidate.blockers.includes("EXTENDED_MOVE");
}

function hasQmlRetestEvidence(candidate: OpportunityCandidate): boolean {
  return candidate.evidence.includes("FIRST_RETEST") || candidate.evidence.includes("SECOND_RETEST");
}

function familyTriggerValid(
  candidate: OpportunityCandidate,
  state: MultiTimeframeStateSnapshot,
): boolean {
  if (candidate.family === "PRESSURE_RELEASE") {
    return candidate.evidence.includes("BREAK_ACCEPTED") &&
      (state.m1.state.endsWith("BREAK_ACCEPTED") || state.m5.state.endsWith("ACCEPTANCE"));
  }
  if (candidate.family === "FAILED_BREAK_REVERSAL") {
    return candidate.evidence.includes("BREAK_FAILED") && candidate.evidence.includes("OPPOSITE_RECOVERY");
  }
  if (candidate.family === "IMPULSE_RELOAD") {
    return candidate.evidence.includes("CONTROLLED_PULLBACK") && candidate.evidence.includes("RECOVERY_CONFIRMED");
  }
  if (candidate.family === "SESSION_LIQUIDITY_QML") {
    return candidate.evidence.includes("LIQUIDITY_SWEEP") &&
      candidate.evidence.includes("MARKET_STRUCTURE_SHIFT") &&
      hasQmlRetestEvidence(candidate);
  }
  return candidate.evidence.includes("LOWER_TIMEFRAME_ROTATION") && state.m1.direction === candidate.direction;
}

function hypothesisAllowsConfirmation(
  hypothesis: HypothesisOpportunitySnapshot,
  candidate: OpportunityCandidate,
): { allowed: boolean; exception: boolean } {
  if (candidate.direction === "NEUTRAL") return { allowed: false, exception: false };
  const ownScore = hypothesisScore(hypothesis, candidate.direction);
  const leadingMatches = hypothesis.leadingHypothesis === candidate.direction;
  const gap = hypothesis.leadingHypothesisScore - ownScore;
  if (
    ownScore >= SIGNAL_DECISION_CONFIG.confirmationMinimumHypothesisScore &&
    (leadingMatches || gap <= SIGNAL_DECISION_CONFIG.confirmationMaximumHypothesisGap)
  ) {
    return { allowed: true, exception: false };
  }
  const qmlFullChain = candidate.family === "SESSION_LIQUIDITY_QML" &&
    candidate.evidence.includes("LIQUIDITY_SWEEP") &&
    candidate.evidence.includes("MARKET_STRUCTURE_SHIFT") &&
    hasQmlRetestEvidence(candidate);
  if (qmlFullChain) {
    const oppositeScore = oppositeHypothesisScore(hypothesis, candidate.direction);
    const rangeOrUnclearThesis = hypothesis.leadingHypothesis === "RANGE" || hypothesis.leadingHypothesisScore < 52;
    const qmlException = candidate.score >= 78 &&
      (rangeOrUnclearThesis || ownScore >= 16 || gap <= 28) &&
      !(oppositeScore >= 72 && oppositeScore >= ownScore + 30);
    return { allowed: qmlException, exception: qmlException };
  }
  const exceptionFamily =
    candidate.family === "FAILED_BREAK_REVERSAL" ||
    candidate.family === "TIMEFRAME_ROTATION";
  const exception = exceptionFamily && candidate.score >= 78 && ownScore >= 32;
  return { allowed: exception, exception };
}

function confirmationQuality(
  candidate: OpportunityCandidate,
  state: MultiTimeframeStateSnapshot,
  hypothesis: HypothesisOpportunitySnapshot,
): {
  valid: boolean;
  fastTrack: boolean;
  reasonMask: number;
  noTradeMask: number;
} {
  let reasonMask = 0;
  let noTradeMask = noTradeMaskFromCandidate(candidate);
  const hypothesisResult = hypothesisAllowsConfirmation(hypothesis, candidate);
  if (hypothesisResult.allowed) {
    reasonMask = addReason(
      reasonMask,
      hypothesisResult.exception ? "REVERSAL_OR_ROTATION_EXCEPTION" : "HYPOTHESIS_ALIGNED",
    );
  } else {
    noTradeMask = addNoTrade(noTradeMask, "AMBIGUOUS_HYPOTHESES");
  }
  if (state.m1.quality === "CLEAN") reasonMask = addReason(reasonMask, "CLEAN_EXECUTION");
  if (candidate.freshnessScore >= 55 && state.m1.freshnessScore >= 50) {
    reasonMask = addReason(reasonMask, "FRESH_TRIGGER");
  }
  if (!familyTriggerValid(candidate, state)) {
    noTradeMask = addNoTrade(noTradeMask, "MISSING_TRIGGER");
  }

  const qmlFamily = candidate.family === "SESSION_LIQUIDITY_QML";
  const confirmationMinimum = qmlFamily ? 68 : SIGNAL_DECISION_CONFIG.confirmationMinimumScore;
  const timingAllowed = qmlFamily
    ? candidate.freshnessScore >= 42 && state.m1.quality !== "NOISY"
    : state.m1.quality !== "LATE" && state.m1.lateEntryRisk !== "HIGH" && state.m5.lateEntryRisk !== "HIGH";
  const valid =
    candidate.stage === "MATURE_CANDIDATE" &&
    candidate.score >= confirmationMinimum &&
    candidate.direction !== "NEUTRAL" &&
    !hasSevereBlocker(candidate) &&
    !hasLateBlocker(candidate) &&
    state.m1.quality !== "NOISY" &&
    timingAllowed &&
    familyTriggerValid(candidate, state) &&
    hypothesisResult.allowed;

  const fastTrack = valid && (qmlFamily || (
    candidate.score >= SIGNAL_DECISION_CONFIG.fastTrackScore &&
    candidate.triggerScore >= SIGNAL_DECISION_CONFIG.fastTrackTriggerScore &&
    candidate.freshnessScore >= SIGNAL_DECISION_CONFIG.fastTrackFreshnessScore &&
    state.m1.quality === "CLEAN"
  ));

  return { valid, fastTrack, reasonMask, noTradeMask };
}

function isHypothesisInvalidated(
  hypothesis: HypothesisOpportunitySnapshot,
  direction: OpportunityDirection,
): boolean {
  if (direction === "NEUTRAL") return false;
  const own = hypothesisScore(hypothesis, direction);
  const opposite = oppositeHypothesisScore(hypothesis, direction);
  return opposite >= 56 && opposite >= own + 14;
}

function baseDecision(runtime: TrackRuntime, candidate: OpportunityCandidate): TrackDecision {
  return {
    state: runtime.state,
    direction: runtime.direction,
    episodeStartIndex: runtime.episodeStartIndex,
    watchIndex: runtime.watchIndex,
    armedIndex: runtime.armedIndex,
    confirmedIndex: runtime.confirmedIndex,
    expiryIndex: runtime.expiryIndex,
    score: candidate.score,
    reasonMask: 0,
    noTradeMask: 0,
    isNewEvent: false,
    duplicateSuppressed: false,
    expired: false,
  };
}

function startEpisode(
  decision: TrackDecision,
  runtime: TrackRuntime,
  candidate: OpportunityCandidate,
  candleIndex: number,
  state: SignalLifecycleState,
): void {
  decision.state = state;
  decision.direction = candidate.direction;
  decision.episodeStartIndex = candleIndex;
  decision.watchIndex = candleIndex;
  decision.armedIndex = state === "ARMED" ? candleIndex : NONE_INDEX;
  decision.confirmedIndex = NONE_INDEX;
  decision.expiryIndex = candleIndex + (
    state === "ARMED" ? SIGNAL_DECISION_CONFIG.armedExpiryBars : SIGNAL_DECISION_CONFIG.watchExpiryBars
  );
  decision.reasonMask = addReason(decision.reasonMask, "OPPORTUNITY_OBSERVED");
  runtime.bestScore = candidate.score;
}

function processTrack(input: {
  runtime: TrackRuntime;
  candidate: OpportunityCandidate;
  state: MultiTimeframeStateSnapshot;
  hypothesis: HypothesisOpportunitySnapshot;
  candleIndex: number;
  lastConfirmedByDirection: Record<"BULLISH" | "BEARISH", number>;
  lastConfirmedFamilyByDirection: Record<"BULLISH" | "BEARISH", OpportunityFamily | null>;
}): TrackDecision {
  const { runtime, candidate, state, hypothesis, candleIndex } = input;
  if (runtime.state === "INVALIDATED" || runtime.state === "NO_TRADE") {
    resetRuntime(runtime);
  }
  const decision = baseDecision(runtime, candidate);
  decision.noTradeMask = noTradeMaskFromCandidate(candidate);

  if (
    isActive(runtime.state) &&
    candidate.direction !== "NEUTRAL" &&
    runtime.direction !== "NEUTRAL" &&
    candidate.direction !== runtime.direction
  ) {
    decision.state = "INVALIDATED";
    decision.reasonMask = addReason(decision.reasonMask, "DIRECTION_FLIPPED");
    decision.isNewEvent = true;
    return decision;
  }

  if (isActive(runtime.state) && isHypothesisInvalidated(hypothesis, runtime.direction)) {
    decision.state = "INVALIDATED";
    decision.reasonMask = addReason(decision.reasonMask, "HYPOTHESIS_INVALIDATED");
    decision.isNewEvent = true;
    return decision;
  }

  if (candidate.stage === "DEGRADED" || hasSevereBlocker(candidate)) {
    decision.reasonMask = addReason(decision.reasonMask, "NOISY_OR_PARTIAL_DATA");
    decision.reasonMask = addReason(decision.reasonMask, "CANDIDATE_DEGRADED");
    decision.state = isActive(runtime.state) ? "INVALIDATED" : "NO_TRADE";
    decision.direction = candidate.direction !== "NEUTRAL" ? candidate.direction : runtime.direction;
    decision.isNewEvent = isActive(runtime.state);
    return decision;
  }

  if (hasLateBlocker(candidate)) {
    decision.reasonMask = addReason(decision.reasonMask, "LATE_OR_EXTENDED");
    decision.state = isActive(runtime.state) ? "INVALIDATED" : "NO_TRADE";
    decision.direction = candidate.direction !== "NEUTRAL" ? candidate.direction : runtime.direction;
    decision.isNewEvent = isActive(runtime.state);
    return decision;
  }

  if (candidate.stage === "ABSENT") {
    if (
      runtime.state === "WATCH" &&
      runtime.lastActiveIndex >= 0 &&
      candleIndex - runtime.lastActiveIndex <= SIGNAL_DECISION_CONFIG.candidateGraceBars
    ) {
      decision.state = "WATCH";
      decision.reasonMask = addReason(decision.reasonMask, "CANDIDATE_GRACE_PERIOD");
      return decision;
    }
    if (isActive(runtime.state)) {
      decision.state = "INVALIDATED";
      decision.reasonMask = addReason(decision.reasonMask, "CANDIDATE_EXPIRED");
      decision.isNewEvent = true;
      decision.expired = true;
      return decision;
    }
    decision.state = "OBSERVING";
    decision.direction = "NEUTRAL";
    decision.reasonMask = addReason(decision.reasonMask, "NO_QUALIFIED_OPPORTUNITY");
    decision.noTradeMask = addNoTrade(decision.noTradeMask, "NO_OPPORTUNITY");
    return decision;
  }

  if (candidate.direction === "NEUTRAL") {
    decision.state = "NO_TRADE";
    decision.direction = "NEUTRAL";
    decision.reasonMask = addReason(decision.reasonMask, "NO_QUALIFIED_OPPORTUNITY");
    decision.noTradeMask = addNoTrade(decision.noTradeMask, "AMBIGUOUS_HYPOTHESES");
    return decision;
  }

  const qmlFullChainBypass = candidate.family === "SESSION_LIQUIDITY_QML" &&
    candidate.stage === "MATURE_CANDIDATE" &&
    candidate.score >= 75 &&
    familyTriggerValid(candidate, state);
  if (runtime.cooldownUntilIndex >= candleIndex && !isActive(runtime.state) && !qmlFullChainBypass) {
    decision.state = "NO_TRADE";
    decision.direction = candidate.direction;
    decision.reasonMask = addReason(decision.reasonMask, "COOLDOWN_ACTIVE");
    decision.noTradeMask = addNoTrade(decision.noTradeMask, "COOLDOWN");
    return decision;
  }

  if (candidate.stage === "WATCH") {
    if (runtime.state === "OBSERVING") {
      startEpisode(decision, runtime, candidate, candleIndex, "WATCH");
    } else if (runtime.state === "ARMED" && candidate.score >= SIGNAL_DECISION_CONFIG.armRetentionScore) {
      decision.state = "ARMED";
      decision.direction = candidate.direction;
    } else {
      decision.state = "WATCH";
      decision.direction = candidate.direction;
      decision.reasonMask = addReason(decision.reasonMask, "OPPORTUNITY_OBSERVED");
    }
  } else if (candidate.stage === "DEVELOPING") {
    if (runtime.state === "OBSERVING") {
      const fastArm = candidate.score >= SIGNAL_DECISION_CONFIG.fastArmScore && state.m1.quality !== "NOISY";
      startEpisode(decision, runtime, candidate, candleIndex, fastArm ? "ARMED" : "WATCH");
      if (fastArm) decision.reasonMask = addReason(decision.reasonMask, "DEVELOPMENT_PERSISTED");
    } else {
      const persisted =
        runtime.direction === candidate.direction &&
        runtime.episodeStartIndex >= 0 &&
        candleIndex - runtime.episodeStartIndex >= SIGNAL_DECISION_CONFIG.minimumWatchPersistenceBars;
      if (
        runtime.state === "ARMED" ||
        persisted ||
        candidate.score >= SIGNAL_DECISION_CONFIG.fastArmScore
      ) {
        decision.state = "ARMED";
        decision.direction = candidate.direction;
        decision.armedIndex = runtime.armedIndex >= 0 ? runtime.armedIndex : candleIndex;
        decision.expiryIndex = decision.armedIndex + SIGNAL_DECISION_CONFIG.armedExpiryBars;
        decision.reasonMask = addReason(decision.reasonMask, "DEVELOPMENT_PERSISTED");
      } else {
        decision.state = "WATCH";
        decision.direction = candidate.direction;
      }
    }
  } else if (candidate.stage === "MATURE_CANDIDATE") {
    const quality = confirmationQuality(candidate, state, hypothesis);
    decision.reasonMask |= quality.reasonMask;
    decision.noTradeMask |= quality.noTradeMask;
    decision.reasonMask = addReason(decision.reasonMask, "MATURE_CANDIDATE");

    if (isConfirmation(runtime.state) && runtime.direction === candidate.direction) {
      decision.state = runtime.state;
      decision.direction = candidate.direction;
      decision.reasonMask = addReason(decision.reasonMask, "CONFIRMATION_PERSISTED");
      decision.reasonMask = addReason(decision.reasonMask, "DUPLICATE_SUPPRESSED");
      decision.duplicateSuppressed = true;
    } else if (!quality.valid) {
      if (decision.noTradeMask & (NO_TRADE_BIT.get("MISSING_TRIGGER") ?? 0)) {
        decision.reasonMask = addReason(decision.reasonMask, "TRIGGER_INCOMPLETE");
      }
      if (runtime.state === "WATCH" || runtime.state === "ARMED") {
        decision.state = "ARMED";
        decision.direction = candidate.direction;
        decision.armedIndex = runtime.armedIndex >= 0 ? runtime.armedIndex : candleIndex;
        decision.expiryIndex = decision.armedIndex + SIGNAL_DECISION_CONFIG.armedExpiryBars;
      } else {
        decision.state = "NO_TRADE";
        decision.direction = candidate.direction;
      }
    } else {
      const persisted =
        runtime.direction === candidate.direction &&
        (runtime.state === "WATCH" || runtime.state === "ARMED") &&
        runtime.episodeStartIndex >= 0 &&
        candleIndex > runtime.episodeStartIndex;
      if (!persisted && !quality.fastTrack) {
        if (runtime.state === "OBSERVING") {
          startEpisode(decision, runtime, candidate, candleIndex, "ARMED");
        } else {
          decision.state = "ARMED";
          decision.direction = candidate.direction;
          decision.armedIndex = runtime.armedIndex >= 0 ? runtime.armedIndex : candleIndex;
          decision.expiryIndex = decision.armedIndex + SIGNAL_DECISION_CONFIG.armedExpiryBars;
        }
      } else {
        if (quality.fastTrack && !persisted) {
          decision.reasonMask = addReason(decision.reasonMask, "FAST_TRACK_CONFIRMATION");
        }
        const direction = candidate.direction as "BULLISH" | "BEARISH";
        const lastConfirmed = input.lastConfirmedByDirection[direction];
        const lastFamily = input.lastConfirmedFamilyByDirection[direction];
        const separated = lastConfirmed >= 0 &&
          candleIndex - lastConfirmed >= SIGNAL_DECISION_CONFIG.continuationMinimumSeparationBars &&
          candleIndex - lastConfirmed <= SIGNAL_DECISION_CONFIG.continuationLookbackBars;
        const continuationFamily =
          candidate.family === "IMPULSE_RELOAD" ||
          candidate.family === "TIMEFRAME_ROTATION" ||
          (lastFamily !== null && lastFamily !== candidate.family);
        const lifecycle: SignalLifecycleState = separated && continuationFamily
          ? "CONTINUATION"
          : "CONFIRMED";
        decision.state = lifecycle;
        decision.direction = candidate.direction;
        decision.episodeStartIndex = runtime.episodeStartIndex >= 0 ? runtime.episodeStartIndex : candleIndex;
        decision.watchIndex = runtime.watchIndex >= 0 ? runtime.watchIndex : candleIndex;
        decision.armedIndex = runtime.armedIndex >= 0 ? runtime.armedIndex : candleIndex;
        decision.confirmedIndex = candleIndex;
        decision.expiryIndex = candleIndex + SIGNAL_DECISION_CONFIG.duplicateCooldownBars;
        decision.isNewEvent = true;
        if (lifecycle === "CONTINUATION") {
          decision.reasonMask = addReason(decision.reasonMask, "CONTINUATION_AFTER_PULLBACK");
        }
      }
    }
  }

  if (
    decision.state === "WATCH" &&
    decision.episodeStartIndex >= 0 &&
    candleIndex > decision.episodeStartIndex + SIGNAL_DECISION_CONFIG.watchExpiryBars
  ) {
    decision.state = "INVALIDATED";
    decision.reasonMask = addReason(decision.reasonMask, "CANDIDATE_EXPIRED");
    decision.isNewEvent = true;
    decision.expired = true;
  }
  if (
    decision.state === "ARMED" &&
    decision.armedIndex >= 0 &&
    candleIndex > decision.armedIndex + SIGNAL_DECISION_CONFIG.armedExpiryBars
  ) {
    decision.state = "INVALIDATED";
    decision.reasonMask = addReason(decision.reasonMask, "CANDIDATE_EXPIRED");
    decision.isNewEvent = true;
    decision.expired = true;
  }
  return decision;
}

function applyDecision(runtime: TrackRuntime, decision: TrackDecision, candleIndex: number): void {
  runtime.state = decision.state;
  runtime.direction = decision.direction;
  runtime.episodeStartIndex = decision.episodeStartIndex;
  runtime.watchIndex = decision.watchIndex;
  runtime.armedIndex = decision.armedIndex;
  runtime.confirmedIndex = decision.confirmedIndex;
  runtime.expiryIndex = decision.expiryIndex;
  runtime.bestScore = Math.max(runtime.bestScore, decision.score);
  if (decision.state !== "OBSERVING" && decision.state !== "NO_TRADE") {
    runtime.lastActiveIndex = candleIndex;
  }
  if (isConfirmation(decision.state) && decision.isNewEvent) {
    runtime.cooldownUntilIndex = candleIndex + SIGNAL_DECISION_CONFIG.duplicateCooldownBars;
  }
  if (decision.state === "INVALIDATED") {
    runtime.cooldownUntilIndex = Math.max(
      runtime.cooldownUntilIndex,
      candleIndex + SIGNAL_DECISION_CONFIG.duplicateCooldownBars,
    );
  }
}

function lifecyclePriority(state: SignalLifecycleState, isNewEvent: boolean): number {
  if ((state === "CONFIRMED" || state === "CONTINUATION") && isNewEvent) return 100;
  if (state === "INVALIDATED" && isNewEvent) return 95;
  if (state === "CONFIRMED" || state === "CONTINUATION") return 90;
  if (state === "ARMED") return 70;
  if (state === "WATCH") return 50;
  if (state === "NO_TRADE") return 30;
  return 10;
}

function primaryFamilyFrom(
  decisions: readonly TrackDecision[],
  candidates: readonly OpportunityCandidate[],
): number {
  let best = -1;
  let bestPriority = -1;
  let bestScore = -1;
  for (let index = 0; index < decisions.length; index += 1) {
    const priority = lifecyclePriority(decisions[index].state, decisions[index].isNewEvent);
    const score = candidates[index].score;
    if (priority > bestPriority || (priority === bestPriority && score > bestScore)) {
      best = index;
      bestPriority = priority;
      bestScore = score;
    }
  }
  return best;
}

function writeDecision(
  arrays: SignalArrays,
  candleIndex: number,
  familyIndex: number,
  decision: TrackDecision,
  candidate: OpportunityCandidate,
  referencePrice: number,
): void {
  const slot = familySlot(candleIndex, familyIndex);
  arrays.state[slot] = LIFECYCLE_CODE[decision.state];
  arrays.direction[slot] = DIRECTION_CODE[decision.direction];
  arrays.candidateStage[slot] = STAGE_CODE[candidate.stage];
  arrays.candidateScore[slot] = clampByte(candidate.score);
  arrays.episodeStartIndex[slot] = decision.episodeStartIndex;
  arrays.watchIndex[slot] = decision.watchIndex;
  arrays.armedIndex[slot] = decision.armedIndex;
  arrays.confirmedIndex[slot] = decision.confirmedIndex;
  arrays.expiryIndex[slot] = decision.expiryIndex;
  arrays.reasonMask[slot] = decision.reasonMask >>> 0;
  arrays.noTradeMask[slot] = decision.noTradeMask;
  arrays.eventFlag[slot] = decision.isNewEvent ? 1 : 0;
  arrays.referencePrice[slot] = referencePrice;
}

function allocateArrays(sampleCount: number): SignalArrays {
  const trackCount = sampleCount * SIGNAL_OPPORTUNITY_FAMILIES.length;
  const episodeStartIndex = new Int32Array(trackCount);
  const watchIndex = new Int32Array(trackCount);
  const armedIndex = new Int32Array(trackCount);
  const confirmedIndex = new Int32Array(trackCount);
  const expiryIndex = new Int32Array(trackCount);
  episodeStartIndex.fill(NONE_INDEX);
  watchIndex.fill(NONE_INDEX);
  armedIndex.fill(NONE_INDEX);
  confirmedIndex.fill(NONE_INDEX);
  expiryIndex.fill(NONE_INDEX);
  const primaryFamily = new Int8Array(sampleCount);
  primaryFamily.fill(NONE_INDEX);
  return {
    state: new Uint8Array(trackCount),
    direction: new Uint8Array(trackCount),
    candidateStage: new Uint8Array(trackCount),
    candidateScore: new Uint8Array(trackCount),
    episodeStartIndex,
    watchIndex,
    armedIndex,
    confirmedIndex,
    expiryIndex,
    reasonMask: new Uint32Array(trackCount),
    noTradeMask: new Uint16Array(trackCount),
    eventFlag: new Uint8Array(trackCount),
    referencePrice: new Float64Array(trackCount),
    primaryFamily,
    primaryState: new Uint8Array(sampleCount),
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

function timestampAt(index: SignalDecisionIndex, candleIndex: number): number | null {
  if (candleIndex < 0 || candleIndex >= index.stateIndex.datasets.M1.candles.length) return null;
  return index.stateIndex.datasets.M1.candles[candleIndex][0] + MINUTE_MS;
}

function episodeId(
  index: SignalDecisionIndex,
  family: OpportunityFamily,
  direction: OpportunityDirection,
  episodeStartIndex: number,
): string | null {
  const timestamp = timestampAt(index, episodeStartIndex);
  return timestamp === null || direction === "NEUTRAL"
    ? null
    : `${family}:${direction}:${timestamp}`;
}

function reconstructTrack(
  index: SignalDecisionIndex,
  candleIndex: number,
  familyIndex: number,
  opportunity: OpportunityCandidate,
): SignalTrackSnapshot {
  const slot = familySlot(candleIndex, familyIndex);
  const lifecycle = CODE_LIFECYCLE[index.arrays.state[slot]] ?? "OBSERVING";
  const direction = CODE_DIRECTION[index.arrays.direction[slot]] ?? "NEUTRAL";
  const started = index.arrays.episodeStartIndex[slot];
  const armed = index.arrays.armedIndex[slot];
  const confirmed = index.arrays.confirmedIndex[slot];
  const expiry = index.arrays.expiryIndex[slot];
  return {
    family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
    direction,
    lifecycle,
    action: actionFor(lifecycle, direction),
    candidateStage: CODE_STAGE[index.arrays.candidateStage[slot]] ?? "ABSENT",
    candidateScore: index.arrays.candidateScore[slot],
    hypothesisScore: 0,
    episodeId: episodeId(index, SIGNAL_OPPORTUNITY_FAMILIES[familyIndex], direction, started),
    ageBars: started >= 0 ? Math.max(0, candleIndex - started) : 0,
    startedAtMs: timestampAt(index, started),
    armedAtMs: timestampAt(index, armed),
    confirmedAtMs: timestampAt(index, confirmed),
    expiresAtMs:
      started >= 0 && expiry >= 0
        ? (timestampAt(index, started) ?? 0) + (expiry - started) * MINUTE_MS
        : null,
    referencePrice: Number.isFinite(index.arrays.referencePrice[slot])
      ? index.arrays.referencePrice[slot]
      : null,
    reasons: decodeReasons(index.arrays.reasonMask[slot]),
    noTradeReasons: decodeNoTrade(index.arrays.noTradeMask[slot]),
    opportunityBlockers: opportunity.blockers,
    isNewEvent: index.arrays.eventFlag[slot] === 1,
  };
}

function globalNoTradeReasons(
  state: MultiTimeframeStateSnapshot,
  hypothesis: HypothesisOpportunitySnapshot,
  tracks: readonly SignalTrackSnapshot[],
): NoTradeReasonCode[] {
  let mask = 0;
  for (const track of tracks) {
    for (const reason of track.noTradeReasons) mask = addNoTrade(mask, reason);
  }
  if (hypothesis.opportunityAvailability === "NONE") mask = addNoTrade(mask, "NO_OPPORTUNITY");
  if (state.composite.availableLayers < 4) mask = addNoTrade(mask, "PARTIAL_DATA");
  if (state.composite.state === "NOISE") mask = addNoTrade(mask, "NOISY_MARKET");
  if (state.composite.alignment === "DESTRUCTIVE_DISAGREEMENT") {
    mask = addNoTrade(mask, "DESTRUCTIVE_TIMEFRAME_CONFLICT");
  }
  const sorted = [...hypothesis.hypotheses].sort((a, b) => b.score - a.score);
  if (sorted[0].score >= 48 && sorted[1].score >= 48 && sorted[0].score - sorted[1].score < 5) {
    mask = addNoTrade(mask, "AMBIGUOUS_HYPOTHESES");
  }
  return decodeNoTrade(mask);
}

function reconstructSnapshot(
  index: SignalDecisionIndex,
  candleIndex: number,
  state: MultiTimeframeStateSnapshot,
  hypothesis: HypothesisOpportunitySnapshot,
): SignalDecisionSnapshot {
  const tracks = SIGNAL_OPPORTUNITY_FAMILIES.map((family, familyIndex) => {
    const opportunity = opportunityByFamily(hypothesis, family);
    const track = reconstructTrack(index, candleIndex, familyIndex, opportunity);
    track.hypothesisScore = hypothesisScore(hypothesis, track.direction);
    return track;
  });
  const primaryFamily = index.arrays.primaryFamily[candleIndex];
  const primaryTrack = primaryFamily >= 0 ? tracks[primaryFamily] : null;
  const lifecycle = primaryTrack?.lifecycle ?? "OBSERVING";
  const action = primaryTrack?.action ?? "NONE";
  return {
    timestampMs: state.timestampMs,
    lifecycle,
    action,
    primaryTrack,
    tracks,
    activeTrackCount: tracks.filter((track) => isActive(track.lifecycle)).length,
    actionableTrackCount: tracks.filter((track) => isConfirmation(track.lifecycle)).length,
    noTradeReasons: globalNoTradeReasons(state, hypothesis, tracks),
    semantics: "DECISION_SIGNAL_NOT_EXECUTION_PERMISSION",
  };
}

function buildIndex(
  stateIndex: MultiTimeframeStateIndex,
  sessionLiquidityIndex: SessionLiquidityIndex,
): SignalDecisionIndex {
  const sampleCount = stateIndex.datasets.M1.candles.length;
  const arrays = allocateArrays(sampleCount);
  const runtimes = SIGNAL_OPPORTUNITY_FAMILIES.map(() => newRuntime());
  const lastConfirmedByDirection: Record<"BULLISH" | "BEARISH", number> = {
    BULLISH: NONE_INDEX,
    BEARISH: NONE_INDEX,
  };
  const lastConfirmedFamilyByDirection: Record<"BULLISH" | "BEARISH", OpportunityFamily | null> = {
    BULLISH: null,
    BEARISH: null,
  };

  const lifecycleCounts = createCountRecord(LIFECYCLES);
  const actionCounts = createCountRecord(ACTIONS);
  const confirmedByFamily = createCountRecord(SIGNAL_OPPORTUNITY_FAMILIES);
  const confirmedByDirection = { BULLISH: 0, BEARISH: 0 };
  const noTradeReasonCounts = createCountRecord(NO_TRADE_REASONS);
  const strongestSignals = new FixedMinHeap<SignalDecisionEvent>(
    SIGNAL_DECISION_CONFIG.strongestSignalLimit,
    (item) => item.score,
  );

  const eventSlots: number[] = [];
  const recentEvents: SignalDecisionEvent[] = [];

  const directionCounts = createCountRecord(PRICE_DIRECTIONS);
  const alignmentCounts = createCountRecord(ALIGNMENTS);
  const stateCounts = createCountRecord(COMPOSITE_STATES);
  const strongestStates = new FixedMinHeap<MultiTimeframeStateEvent>(24, (item) => item.evidenceScore);
  const leadingHypothesisCounts = createCountRecord(HYPOTHESIS_DIRECTIONS);
  const opportunityStageCounts = createCountRecord(OPPORTUNITY_STAGES);
  const opportunityFamilyCounts = createCountRecord(SIGNAL_OPPORTUNITY_FAMILIES);
  const strongestOpportunities = new FixedMinHeap<OpportunityEvent>(24, (item) => item.score);

  let confirmedSignalCount = 0;
  let continuationSignalCount = 0;
  let invalidationCount = 0;
  let duplicateSuppressedCount = 0;
  let expiredCandidateCount = 0;
  let armedEpisodeCount = 0;
  let watchToArmedTotal = 0;
  let watchToArmedSamples = 0;
  let armedToConfirmedTotal = 0;
  let armedToConfirmedSamples = 0;
  let evidenceTotal = 0;
  let leadingScoreTotal = 0;
  let bestOpportunityTotal = 0;
  let bestOpportunitySamples = 0;
  let matureCandidateCount = 0;
  let latestState: MultiTimeframeStateSnapshot | null = null;
  let latestOpportunity: HypothesisOpportunitySnapshot | null = null;

  forEachMultiTimeframeState(stateIndex, (state, feature, candleIndex) => {
    latestState = state;
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

    const hypothesis = evaluateHypothesesAndOpportunities(
      state,
      feature,
      sessionLiquidityAtIndex(sessionLiquidityIndex, candleIndex),
    );
    latestOpportunity = hypothesis;
    leadingScoreTotal += hypothesis.leadingHypothesisScore;
    leadingHypothesisCounts[hypothesis.leadingHypothesis] += 1;
    for (const opportunity of hypothesis.opportunities) {
      opportunityStageCounts[opportunity.stage] += 1;
      if (opportunity.stage !== "ABSENT") opportunityFamilyCounts[opportunity.family] += 1;
      if (opportunity.stage === "MATURE_CANDIDATE") {
        matureCandidateCount += 1;
        strongestOpportunities.push({
          timestampMs: hypothesis.timestampMs,
          family: opportunity.family,
          direction: opportunity.direction,
          stage: opportunity.stage,
          score: opportunity.score,
        });
      }
    }
    if (hypothesis.bestOpportunity) {
      bestOpportunityTotal += hypothesis.bestOpportunity.score;
      bestOpportunitySamples += 1;
    }

    const candidates = SIGNAL_OPPORTUNITY_FAMILIES.map((family) => opportunityByFamily(hypothesis, family));
    const decisions: TrackDecision[] = [];
    const referencePrice = stateIndex.datasets.M1.candles[candleIndex][4];

    for (let familyIndex = 0; familyIndex < SIGNAL_OPPORTUNITY_FAMILIES.length; familyIndex += 1) {
      const runtime = runtimes[familyIndex];
      const previousState = runtime.state;
      const previousWatchIndex = runtime.watchIndex;
      const previousArmedIndex = runtime.armedIndex;
      const decision = processTrack({
        runtime,
        candidate: candidates[familyIndex],
        state,
        hypothesis,
        candleIndex,
        lastConfirmedByDirection,
        lastConfirmedFamilyByDirection,
      });
      decisions.push(decision);

      if (decision.state === "ARMED" && previousState !== "ARMED") {
        armedEpisodeCount += 1;
        if (previousWatchIndex >= 0) {
          watchToArmedTotal += candleIndex - previousWatchIndex;
          watchToArmedSamples += 1;
        }
      }
      if (isConfirmation(decision.state) && decision.isNewEvent) {
        if (decision.state === "CONFIRMED") confirmedSignalCount += 1;
        else continuationSignalCount += 1;
        const direction = decision.direction as "BULLISH" | "BEARISH";
        confirmedByFamily[SIGNAL_OPPORTUNITY_FAMILIES[familyIndex]] += 1;
        confirmedByDirection[direction] += 1;
        if (previousArmedIndex >= 0) {
          armedToConfirmedTotal += candleIndex - previousArmedIndex;
          armedToConfirmedSamples += 1;
        }
        lastConfirmedByDirection[direction] = candleIndex;
        lastConfirmedFamilyByDirection[direction] = SIGNAL_OPPORTUNITY_FAMILIES[familyIndex];
        const episodeStartTimestamp =
          decision.episodeStartIndex >= 0
            ? stateIndex.datasets.M1.candles[decision.episodeStartIndex][0] + MINUTE_MS
            : state.timestampMs;
        const eventEpisodeId = `${SIGNAL_OPPORTUNITY_FAMILIES[familyIndex]}:${direction}:${episodeStartTimestamp}`;
        const signalEvent: SignalDecisionEvent = {
          timestampMs: state.timestampMs,
          family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
          direction,
          lifecycle: decision.state === "CONTINUATION" ? "CONTINUATION" : "CONFIRMED",
          action: actionFor(decision.state, direction),
          score: candidates[familyIndex].score,
          referencePrice,
          episodeId: eventEpisodeId,
        };
        strongestSignals.push(signalEvent);
        recentEvents.push(signalEvent);
        if (recentEvents.length > 30) recentEvents.shift();
      }
      if (decision.state === "INVALIDATED" && decision.isNewEvent) {
        invalidationCount += 1;
        const invalidationDirection = decision.direction;
        const startTimestamp =
          decision.episodeStartIndex >= 0
            ? stateIndex.datasets.M1.candles[decision.episodeStartIndex][0] + MINUTE_MS
            : state.timestampMs;
        const invalidationEvent: SignalDecisionEvent = {
          timestampMs: state.timestampMs,
          family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
          direction: invalidationDirection,
          lifecycle: "INVALIDATED",
          action: "NONE",
          score: candidates[familyIndex].score,
          referencePrice,
          episodeId: `${SIGNAL_OPPORTUNITY_FAMILIES[familyIndex]}:${invalidationDirection}:${startTimestamp}`,
        };
        recentEvents.push(invalidationEvent);
        if (recentEvents.length > 30) recentEvents.shift();
      }
      if (decision.isNewEvent && (isConfirmation(decision.state) || decision.state === "INVALIDATED")) {
        eventSlots.push(familySlot(candleIndex, familyIndex));
      }
      if (decision.duplicateSuppressed) duplicateSuppressedCount += 1;
      if (decision.expired) expiredCandidateCount += 1;
      for (const reason of decodeNoTrade(decision.noTradeMask)) noTradeReasonCounts[reason] += 1;

      writeDecision(arrays, candleIndex, familyIndex, decision, candidates[familyIndex], referencePrice);
      applyDecision(runtime, decision, candleIndex);
    }

    const primaryFamily = primaryFamilyFrom(decisions, candidates);
    arrays.primaryFamily[candleIndex] = primaryFamily;
    const primaryState = primaryFamily >= 0 ? decisions[primaryFamily].state : "OBSERVING";
    arrays.primaryState[candleIndex] = LIFECYCLE_CODE[primaryState];
    lifecycleCounts[primaryState] += 1;
    const primaryDirection = primaryFamily >= 0 ? decisions[primaryFamily].direction : "NEUTRAL";
    actionCounts[actionFor(primaryState, primaryDirection)] += 1;
  });

  const marketStateSummary: MultiTimeframeStateSummary = {
    sampleCount,
    directionCounts,
    alignmentCounts,
    stateCounts,
    averageEvidenceScore: sampleCount > 0 ? stable(evidenceTotal / sampleCount) : 0,
    strongestEvents: strongestStates.toDescendingArray(),
  };
  const hypothesisOpportunitySummary: HypothesisOpportunitySummary = {
    sampleCount,
    leadingHypothesisCounts,
    opportunityStageCounts,
    opportunityFamilyCounts,
    matureCandidateCount,
    averageLeadingHypothesisScore: sampleCount > 0 ? stable(leadingScoreTotal / sampleCount) : 0,
    averageBestOpportunityScore:
      bestOpportunitySamples > 0 ? stable(bestOpportunityTotal / bestOpportunitySamples) : 0,
    strongestOpportunities: strongestOpportunities.toDescendingArray(),
  };
  const summary: SignalDecisionSummary = {
    sampleCount,
    lifecycleCounts,
    actionCounts,
    confirmedByFamily,
    confirmedByDirection,
    noTradeReasonCounts,
    confirmedSignalCount,
    continuationSignalCount,
    invalidationCount,
    duplicateSuppressedCount,
    expiredCandidateCount,
    armedEpisodeCount,
    averageWatchToArmedBars:
      watchToArmedSamples > 0 ? stable(watchToArmedTotal / watchToArmedSamples) : 0,
    averageArmedToConfirmedBars:
      armedToConfirmedSamples > 0 ? stable(armedToConfirmedTotal / armedToConfirmedSamples) : 0,
    strongestSignals: strongestSignals.toDescendingArray(),
    recentEvents: [...recentEvents],
  };

  const index: SignalDecisionIndex = {
    stateIndex,
    sessionLiquidityIndex,
    arrays,
    summary,
    latest: null,
    marketStateSummary,
    latestMarketState: latestState,
    hypothesisOpportunitySummary,
    latestHypothesisOpportunity: latestOpportunity,
    eventSlots: Int32Array.from(eventSlots),
  };
  if (sampleCount > 0 && latestState && latestOpportunity) {
    index.latest = reconstructSnapshot(index, sampleCount - 1, latestState, latestOpportunity);
  }
  return index;
}

export function createSignalDecisionIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: BuildOptions,
): SignalDecisionIndex {
  const stateIndex = getOrCreateMultiTimeframeStateIndex(datasets, options);
  const sessionLiquidityIndex = getOrCreateSessionLiquidityIndex(datasets, options.dailyBoundaryMode);
  return buildIndex(stateIndex, sessionLiquidityIndex);
}

export function getOrCreateSignalDecisionIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: BuildOptions,
): SignalDecisionIndex {
  const cached = indexCache.get(datasets);
  if (cached && cached.stateIndex.dailyBoundaryMode === options.dailyBoundaryMode) return cached;
  const created = createSignalDecisionIndex(datasets, options);
  indexCache.set(datasets, created);
  return created;
}

function firstM1IndexAtOrAfter(candles: readonly CompactCandle[], timestampMs: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] + MINUTE_MS < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Rebuilds Phase 6 statistics only for the user-selected interval, excluding warm-up candles. */
export function summarizeSignalDecisionRange(
  index: SignalDecisionIndex,
  fromTimestampMs: number,
  toTimestampMs: number,
): SignalDecisionSummary {
  const candles = index.stateIndex.datasets.M1.candles;
  const start = firstM1IndexAtOrAfter(candles, fromTimestampMs);
  const end = firstM1IndexAtOrAfter(candles, toTimestampMs);
  const lifecycleCounts = createCountRecord(LIFECYCLES);
  const actionCounts = createCountRecord(ACTIONS);
  const confirmedByFamily = createCountRecord(SIGNAL_OPPORTUNITY_FAMILIES);
  const confirmedByDirection = { BULLISH: 0, BEARISH: 0 };
  const noTradeReasonCounts = createCountRecord(NO_TRADE_REASONS);
  const strongestSignals = new FixedMinHeap<SignalDecisionEvent>(
    SIGNAL_DECISION_CONFIG.strongestSignalLimit,
    (item) => item.score,
  );
  const recentEvents: SignalDecisionEvent[] = [];
  let confirmedSignalCount = 0;
  let continuationSignalCount = 0;
  let invalidationCount = 0;
  let duplicateSuppressedCount = 0;
  let expiredCandidateCount = 0;
  let armedEpisodeCount = 0;
  let watchToArmedTotal = 0;
  let watchToArmedSamples = 0;
  let armedToConfirmedTotal = 0;
  let armedToConfirmedSamples = 0;

  for (let candleIndex = start; candleIndex < end; candleIndex += 1) {
    const primaryFamily = index.arrays.primaryFamily[candleIndex];
    const primaryLifecycle = CODE_LIFECYCLE[index.arrays.primaryState[candleIndex]] ?? "OBSERVING";
    lifecycleCounts[primaryLifecycle] += 1;
    const primaryDirection = primaryFamily >= 0
      ? CODE_DIRECTION[index.arrays.direction[familySlot(candleIndex, primaryFamily)]] ?? "NEUTRAL"
      : "NEUTRAL";
    actionCounts[actionFor(primaryLifecycle, primaryDirection)] += 1;

    for (let familyIndex = 0; familyIndex < SIGNAL_OPPORTUNITY_FAMILIES.length; familyIndex += 1) {
      const slot = familySlot(candleIndex, familyIndex);
      const lifecycle = CODE_LIFECYCLE[index.arrays.state[slot]] ?? "OBSERVING";
      const direction = CODE_DIRECTION[index.arrays.direction[slot]] ?? "NEUTRAL";
      const reasons = decodeReasons(index.arrays.reasonMask[slot]);
      if (reasons.includes("DUPLICATE_SUPPRESSED")) duplicateSuppressedCount += 1;
      if (reasons.includes("CANDIDATE_EXPIRED")) expiredCandidateCount += 1;
      for (const reason of decodeNoTrade(index.arrays.noTradeMask[slot])) noTradeReasonCounts[reason] += 1;

      const previousLifecycle = candleIndex > start
        ? CODE_LIFECYCLE[index.arrays.state[familySlot(candleIndex - 1, familyIndex)]] ?? "OBSERVING"
        : "OBSERVING";
      if (lifecycle === "ARMED" && previousLifecycle !== "ARMED") {
        armedEpisodeCount += 1;
        const watchIndex = index.arrays.watchIndex[slot];
        if (watchIndex >= 0) {
          watchToArmedTotal += candleIndex - watchIndex;
          watchToArmedSamples += 1;
        }
      }

      if (index.arrays.eventFlag[slot] !== 1) continue;
      const family = SIGNAL_OPPORTUNITY_FAMILIES[familyIndex];
      const score = index.arrays.candidateScore[slot];
      const event: SignalDecisionEvent = {
        timestampMs: candles[candleIndex][0] + MINUTE_MS,
        family,
        direction,
        lifecycle: lifecycle === "CONTINUATION" ? "CONTINUATION" : lifecycle === "INVALIDATED" ? "INVALIDATED" : "CONFIRMED",
        action: actionFor(lifecycle, direction),
        score,
        referencePrice: index.arrays.referencePrice[slot],
        episodeId: episodeId(index, family, direction, index.arrays.episodeStartIndex[slot]) ?? `${family}:${direction}:${candles[candleIndex][0] + MINUTE_MS}`,
      };
      recentEvents.push(event);
      if (recentEvents.length > 30) recentEvents.shift();
      if (lifecycle === "CONFIRMED" || lifecycle === "CONTINUATION") {
        if (lifecycle === "CONFIRMED") confirmedSignalCount += 1;
        else continuationSignalCount += 1;
        confirmedByFamily[family] += 1;
        if (direction === "BULLISH" || direction === "BEARISH") confirmedByDirection[direction] += 1;
        strongestSignals.push(event);
        const armedIndex = index.arrays.armedIndex[slot];
        if (armedIndex >= 0) {
          armedToConfirmedTotal += candleIndex - armedIndex;
          armedToConfirmedSamples += 1;
        }
      } else if (lifecycle === "INVALIDATED") {
        invalidationCount += 1;
      }
    }
  }

  const sampleCount = Math.max(0, end - start);
  return {
    sampleCount,
    lifecycleCounts,
    actionCounts,
    confirmedByFamily,
    confirmedByDirection,
    noTradeReasonCounts,
    confirmedSignalCount,
    continuationSignalCount,
    invalidationCount,
    duplicateSuppressedCount,
    expiredCandidateCount,
    armedEpisodeCount,
    averageWatchToArmedBars: watchToArmedSamples > 0 ? stable(watchToArmedTotal / watchToArmedSamples) : 0,
    averageArmedToConfirmedBars: armedToConfirmedSamples > 0 ? stable(armedToConfirmedTotal / armedToConfirmedSamples) : 0,
    strongestSignals: strongestSignals.toDescendingArray(),
    recentEvents,
  };
}

export function analyzeSignalDecisionAt(
  index: SignalDecisionIndex,
  anchorTimestampMs: number,
): SignalDecisionSnapshot | null {
  const candleIndex = m1IndexAtOrBefore(index.stateIndex.datasets.M1.candles, anchorTimestampMs);
  if (candleIndex < 0) return null;
  const state = analyzeMultiTimeframeStateAt(index.stateIndex, anchorTimestampMs);
  if (!state) return null;
  const feature = analyzePriceBehaviourWindow(
    index.stateIndex.datasets.M1.candles,
    candleIndex,
    1,
  )[0];
  if (!feature) return null;
  const hypothesis = evaluateHypothesesAndOpportunities(
    state,
    feature,
    sessionLiquidityAtIndex(index.sessionLiquidityIndex, candleIndex),
  );
  return reconstructSnapshot(index, candleIndex, state, hypothesis);
}

export function signalDecisionSnapshotAtIndex(
  index: SignalDecisionIndex,
  candleIndex: number,
  state: MultiTimeframeStateSnapshot,
  feature: PriceBehaviour,
): SignalDecisionSnapshot | null {
  if (candleIndex < 0 || candleIndex >= index.stateIndex.datasets.M1.candles.length) return null;
  return reconstructSnapshot(
    index,
    candleIndex,
    state,
    evaluateHypothesesAndOpportunities(
      state,
      feature,
      sessionLiquidityAtIndex(index.sessionLiquidityIndex, candleIndex),
    ),
  );
}

export function asHypothesisOpportunityIndex(index: SignalDecisionIndex): HypothesisOpportunityIndex {
  return {
    stateIndex: index.stateIndex,
    sessionLiquidityIndex: index.sessionLiquidityIndex,
  };
}

export function createSignalDecisionHistory(
  index: SignalDecisionIndex,
  analysisId: string,
  requestedOffset: number,
  requestedLimit: number,
  maximumLimit = 5_000,
  fromTimestampMs = Number.NEGATIVE_INFINITY,
  toTimestampMs = Number.POSITIVE_INFINITY,
): SignalDecisionHistoryResponse {
  const filteredSlots: number[] = [];
  for (const slot of index.eventSlots) {
    const candleIndex = Math.floor(slot / SIGNAL_OPPORTUNITY_FAMILIES.length);
    const timestampMs = index.stateIndex.datasets.M1.candles[candleIndex]?.[0] + MINUTE_MS;
    if (timestampMs >= fromTimestampMs && timestampMs < toTimestampMs) filteredSlots.push(slot);
  }
  const total = filteredSlots.length;
  const limit = Math.max(1, Math.min(maximumLimit, Math.floor(requestedLimit)));
  const maximumOffset = Math.max(0, total - limit);
  const offset = Math.max(0, Math.min(maximumOffset, Math.floor(requestedOffset)));
  const end = Math.min(total, offset + limit);
  const items: SignalDecisionHistoryItem[] = [];

  for (let eventIndex = offset; eventIndex < end; eventIndex += 1) {
    const slot = filteredSlots[eventIndex];
    const candleIndex = Math.floor(slot / SIGNAL_OPPORTUNITY_FAMILIES.length);
    const familyIndex = slot % SIGNAL_OPPORTUNITY_FAMILIES.length;
    const lifecycle = CODE_LIFECYCLE[index.arrays.state[slot]];
    if (lifecycle !== "CONFIRMED" && lifecycle !== "CONTINUATION" && lifecycle !== "INVALIDATED") {
      continue;
    }
    const direction = CODE_DIRECTION[index.arrays.direction[slot]] ?? "NEUTRAL";
    const started = index.arrays.episodeStartIndex[slot];
    items.push({
      timestampMs: index.stateIndex.datasets.M1.candles[candleIndex][0] + MINUTE_MS,
      family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
      direction,
      lifecycle,
      action: actionFor(lifecycle, direction),
      candidateScore: index.arrays.candidateScore[slot],
      referencePrice: index.arrays.referencePrice[slot],
      episodeId: episodeId(index, SIGNAL_OPPORTUNITY_FAMILIES[familyIndex], direction, started),
      reasons: decodeReasons(index.arrays.reasonMask[slot]),
      noTradeReasons: decodeNoTrade(index.arrays.noTradeMask[slot]),
    });
  }

  return { analysisId, offset, limit, total, items };
}


function chartCandleIndexAtOrBefore(
  candles: readonly CompactCandle[],
  timestampMs: number,
): number {
  let low = 0;
  let high = candles.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] <= timestampMs) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

function firstEventSlotAtOrAfterM1Index(eventSlots: Int32Array, targetIndex: number): number {
  let low = 0;
  let high = eventSlots.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candleIndex = Math.floor(eventSlots[middle] / SIGNAL_OPPORTUNITY_FAMILIES.length);
    if (candleIndex < targetIndex) low = middle + 1;
    else high = middle;
  }
  return low;
}

function familyLabel(family: OpportunityFamily): string {
  if (family === "PRESSURE_RELEASE") return "PR";
  if (family === "FAILED_BREAK_REVERSAL") return "FBR";
  if (family === "IMPULSE_RELOAD") return "IR";
  return "TR";
}

/**
 * Returns every Phase 6 decision event that belongs to the requested chart window.
 * Event slots are chronological, so the scan starts with a binary search and stops
 * as soon as the event moves beyond the window.
 */
export function createSignalMarkersForWindow(
  index: SignalDecisionIndex,
  chartTimeframe: Timeframe,
  chartCandles: readonly CompactCandle[],
  requestedOffset: number,
  requestedEnd: number,
  dailyBoundaryMode: DailyBoundaryMode,
): ChartSignalMarker[] {
  if (chartCandles.length === 0 || requestedEnd <= requestedOffset) return [];
  const offset = Math.max(0, Math.min(chartCandles.length - 1, requestedOffset));
  const end = Math.max(offset + 1, Math.min(chartCandles.length, requestedEnd));
  const windowStartMs = chartCandles[offset][0];
  const lastChartOpenMs = chartCandles[end - 1][0];
  const windowEndMs = chartTimeframe === "D1"
    ? getNextDailyBucketStart(lastChartOpenMs, dailyBoundaryMode)
    : lastChartOpenMs + TIMEFRAME_MS[chartTimeframe];
  const m1Candles = index.stateIndex.datasets.M1.candles;
  const firstM1Index = Math.max(0, chartCandleIndexAtOrBefore(m1Candles, windowStartMs));
  const firstEventIndex = firstEventSlotAtOrAfterM1Index(index.eventSlots, firstM1Index);
  const markers: ChartSignalMarker[] = [];

  for (let eventIndex = firstEventIndex; eventIndex < index.eventSlots.length; eventIndex += 1) {
    const slot = index.eventSlots[eventIndex];
    const m1Index = Math.floor(slot / SIGNAL_OPPORTUNITY_FAMILIES.length);
    const familyIndex = slot % SIGNAL_OPPORTUNITY_FAMILIES.length;
    const signalCandle = m1Candles[m1Index];
    if (!signalCandle) continue;
    const signalCandleOpenMs = signalCandle[0];
    if (signalCandleOpenMs < windowStartMs) continue;
    if (signalCandleOpenMs >= windowEndMs) break;

    const chartIndex = chartCandleIndexAtOrBefore(chartCandles, signalCandleOpenMs);
    if (chartIndex < offset || chartIndex >= end) continue;
    const lifecycle = CODE_LIFECYCLE[index.arrays.state[slot]];
    if (lifecycle !== "CONFIRMED" && lifecycle !== "CONTINUATION" && lifecycle !== "INVALIDATED") {
      continue;
    }
    const direction = CODE_DIRECTION[index.arrays.direction[slot]] ?? "NEUTRAL";
    const action = actionFor(lifecycle, direction);
    const family = SIGNAL_OPPORTUNITY_FAMILIES[familyIndex];
    const score = index.arrays.candidateScore[slot];
    const lifecycleLabel = lifecycle === "CONTINUATION" ? "CONT" : lifecycle === "INVALIDATED" ? "X" : "CONF";
    markers.push({
      timestampMs: chartCandles[chartIndex][0],
      eventTimestampMs: signalCandleOpenMs + MINUTE_MS,
      family,
      direction,
      lifecycle,
      action,
      score,
      referencePrice: index.arrays.referencePrice[slot],
      label: lifecycle === "INVALIDATED"
        ? `${lifecycleLabel} ${familyLabel(family)}`
        : `${action} ${lifecycleLabel} ${familyLabel(family)} ${score}`,
      markerKind: "RESEARCH",
    });
  }
  return markers;
}

export interface SignalDecisionSimulationSample {
  state: MultiTimeframeStateSnapshot;
  feature: PriceBehaviour;
  referencePrice: number;
}

export interface SignalDecisionSimulationStep {
  timestampMs: number;
  tracks: Array<{
    family: OpportunityFamily;
    direction: OpportunityDirection;
    lifecycle: SignalLifecycleState;
    action: SignalAction;
    candidateStage: OpportunityStage;
    candidateScore: number;
    reasons: SignalDecisionReasonCode[];
    noTradeReasons: NoTradeReasonCode[];
    isNewEvent: boolean;
  }>;
}

/**
 * Deterministic closed-candle lifecycle simulator used by tests and future replay tooling.
 * It deliberately consumes samples only in the supplied order and never reads a future item.
 */
export function simulateSignalDecisionSequence(
  samples: readonly SignalDecisionSimulationSample[],
): SignalDecisionSimulationStep[] {
  const runtimes = SIGNAL_OPPORTUNITY_FAMILIES.map(() => newRuntime());
  const lastConfirmedByDirection: Record<"BULLISH" | "BEARISH", number> = {
    BULLISH: NONE_INDEX,
    BEARISH: NONE_INDEX,
  };
  const lastConfirmedFamilyByDirection: Record<"BULLISH" | "BEARISH", OpportunityFamily | null> = {
    BULLISH: null,
    BEARISH: null,
  };
  const output: SignalDecisionSimulationStep[] = [];

  for (let candleIndex = 0; candleIndex < samples.length; candleIndex += 1) {
    const sample = samples[candleIndex];
    const hypothesis = evaluateHypothesesAndOpportunities(sample.state, sample.feature, null);
    const candidates = SIGNAL_OPPORTUNITY_FAMILIES.map((family) => opportunityByFamily(hypothesis, family));
    const tracks: SignalDecisionSimulationStep["tracks"] = [];

    for (let familyIndex = 0; familyIndex < SIGNAL_OPPORTUNITY_FAMILIES.length; familyIndex += 1) {
      const runtime = runtimes[familyIndex];
      const decision = processTrack({
        runtime,
        candidate: candidates[familyIndex],
        state: sample.state,
        hypothesis,
        candleIndex,
        lastConfirmedByDirection,
        lastConfirmedFamilyByDirection,
      });
      if (isConfirmation(decision.state) && decision.isNewEvent) {
        const direction = decision.direction as "BULLISH" | "BEARISH";
        lastConfirmedByDirection[direction] = candleIndex;
        lastConfirmedFamilyByDirection[direction] = SIGNAL_OPPORTUNITY_FAMILIES[familyIndex];
      }
      tracks.push({
        family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
        direction: decision.direction,
        lifecycle: decision.state,
        action: actionFor(decision.state, decision.direction),
        candidateStage: candidates[familyIndex].stage,
        candidateScore: candidates[familyIndex].score,
        reasons: decodeReasons(decision.reasonMask),
        noTradeReasons: decodeNoTrade(decision.noTradeMask),
        isNewEvent: decision.isNewEvent,
      });
      applyDecision(runtime, decision, candleIndex);
    }
    output.push({ timestampMs: sample.state.timestampMs, tracks });
  }
  return output;
}


export interface CompactSignalTrackState {
  family: OpportunityFamily;
  lifecycle: SignalLifecycleState;
  direction: OpportunityDirection;
  candidateStage: OpportunityStage;
  candidateScore: number;
  referencePrice: number;
  isNewEvent: boolean;
  confirmedIndex: number;
  episodeStartIndex: number;
}

/** Compact O(1) Phase 6 accessor for downstream deterministic engines. */
export function signalTrackStateAtIndex(
  index: SignalDecisionIndex,
  candleIndex: number,
  familyIndex: number,
): CompactSignalTrackState | null {
  if (candleIndex < 0 || candleIndex >= index.stateIndex.datasets.M1.candles.length) return null;
  if (familyIndex < 0 || familyIndex >= SIGNAL_OPPORTUNITY_FAMILIES.length) return null;
  const slot = familySlot(candleIndex, familyIndex);
  return {
    family: SIGNAL_OPPORTUNITY_FAMILIES[familyIndex],
    lifecycle: CODE_LIFECYCLE[index.arrays.state[slot]] ?? "OBSERVING",
    direction: CODE_DIRECTION[index.arrays.direction[slot]] ?? "NEUTRAL",
    candidateStage: CODE_STAGE[index.arrays.candidateStage[slot]] ?? "ABSENT",
    candidateScore: index.arrays.candidateScore[slot],
    referencePrice: index.arrays.referencePrice[slot],
    isNewEvent: index.arrays.eventFlag[slot] === 1,
    confirmedIndex: index.arrays.confirmedIndex[slot],
    episodeStartIndex: index.arrays.episodeStartIndex[slot],
  };
}

export function signalCandleIndexAtOrBefore(
  index: SignalDecisionIndex,
  anchorTimestampMs: number,
): number {
  return m1IndexAtOrBefore(index.stateIndex.datasets.M1.candles, anchorTimestampMs);
}
