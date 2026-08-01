import { FixedMinHeap } from "./fixed-min-heap";
import { forEachPriceBehaviour } from "./price-behaviour";
import {
  SIGNAL_OPPORTUNITY_FAMILIES,
  getOrCreateSignalDecisionIndex,
  signalCandleIndexAtOrBefore,
  signalTrackStateAtIndex,
  type SignalDecisionIndex,
} from "./signal-decision";
import type { DailyBoundaryMode } from "./market-session";
import type {
  CompactCandle,
  EntryZone,
  ExpectedMovementPlan,
  ExecutionCostAssumption,
  ExecutionQualification,
  FilledExecutionMetrics,
  OpportunityDirection,
  OpportunityFamily,
  PriceBehaviour,
  SignalAction,
  StructuralRiskPlan,
  TargetLevelSource,
  TargetSpacePlan,
  Timeframe,
  TimeframeDataset,
  TradeHealthState,
  TradeManagementSettings,
  TradeManagementSummary,
  TradePlanEvent,
  TradePlanHistoryItem,
  TradePlanHistoryResponse,
  TradePlanLimitationCode,
  TradePlanReasonCode,
  TradePlanRejectionCode,
  TradePlanSnapshot,
  TradePlanStatus,
  TradeTarget,
} from "./types";

const MINUTE_MS = 60_000;
const NONE = -1;
const FAMILY_COUNT = SIGNAL_OPPORTUNITY_FAMILIES.length;

export const TRADE_MANAGEMENT_CONFIG = Object.freeze({
  minimumRiskReward: 1.5,
  preferredRiskReward: 2,
  maximumRiskInAverageRanges: 3.5,
  minimumRiskInAverageRanges: 0.25,
  safetyBufferAverageRange: 0.15,
  entryZoneHalfWidthAverageRange: 0.22,
  noChaseAverageRange: 0.8,
  targetLookbackBars: 300,
  swingRadius: 2,
  terminalDisplayBars: 60,
  strongestPlanLimit: 30,
  expectedMovementMaximumAverageRanges: 8,
});

const STATUSES: readonly TradePlanStatus[] = [
  "NO_SIGNAL",
  "REJECTED",
  "WAIT_ENTRY",
  "ENTRY_VALID",
  "ACTIVE",
  "TARGET1_HIT",
  "TARGET2_HIT",
  "COMPLETED",
  "EXPIRED",
  "INVALIDATED",
  "AMBIGUOUS_INTRABAR",
];
const HEALTH_STATES: readonly TradeHealthState[] = [
  "NOT_ACTIVE",
  "HEALTHY",
  "STALLED",
  "WEAKENING",
  "TARGET_PROGRESS",
  "INVALIDATED",
  "AMBIGUOUS",
];
const REJECTIONS: readonly TradePlanRejectionCode[] = [
  "NO_CONFIRMED_SIGNAL",
  "NEUTRAL_DIRECTION",
  "PARTIAL_SOURCE_DATA",
  "INVALID_ENTRY_ZONE",
  "INVALID_STRUCTURAL_STOP",
  "STOP_DISTANCE_TOO_SMALL",
  "STOP_DISTANCE_TOO_WIDE",
  "TARGET_SPACE_INSUFFICIENT",
  "RR_BELOW_MINIMUM",
  "ENTRY_ALREADY_LATE",
  "SIGNAL_EXPIRED",
  "STRUCTURE_INVALIDATED",
  "INTRABAR_SEQUENCE_UNKNOWN",
  "SUPERSEDED_BY_NEW_SIGNAL",
];
const LIMITATIONS: readonly TradePlanLimitationCode[] = [
  "HISTORICAL_OHLC_ONLY",
  "LIVE_SPREAD_UNVERIFIED",
  "BROKER_CONTRACT_UNAVAILABLE",
];

const STATUS_CODE = new Map(STATUSES.map((value, index) => [value, index]));
const HEALTH_CODE = new Map(HEALTH_STATES.map((value, index) => [value, index]));

export interface TradeManagementBuildOptions {
  dailyBoundaryMode: DailyBoundaryMode;
  settings?: Partial<TradeManagementSettings>;
}

export const DEFAULT_TRADE_MANAGEMENT_SETTINGS: TradeManagementSettings = Object.freeze({
  assumedSpreadPrice: 0.25,
  assumedSlippagePrice: 0.1,
  minimumRiskReward: 1.5,
  maximumRiskInAverageRanges: 3.5,
});

function resolveSettings(settings?: Partial<TradeManagementSettings>): TradeManagementSettings {
  return {
    assumedSpreadPrice: Math.max(0, settings?.assumedSpreadPrice ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.assumedSpreadPrice),
    assumedSlippagePrice: Math.max(0, settings?.assumedSlippagePrice ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.assumedSlippagePrice),
    minimumRiskReward: Math.max(1, settings?.minimumRiskReward ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.minimumRiskReward),
    maximumRiskInAverageRanges: Math.max(0.5, settings?.maximumRiskInAverageRanges ?? DEFAULT_TRADE_MANAGEMENT_SETTINGS.maximumRiskInAverageRanges),
  };
}

interface PlanRecord {
  id: number;
  planId: string;
  family: OpportunityFamily;
  familyIndex: number;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  action: Exclude<SignalAction, "NONE">;
  signalIndex: number;
  signalTimestampMs: number;
  candidateScore: number;
  settings: TradeManagementSettings;
  executionCosts: ExecutionCostAssumption;
  entryZone: EntryZone;
  structuralRisk: StructuralRiskPlan;
  targetSpace: TargetSpacePlan;
  expectedMovement: ExpectedMovementPlan;
  reasons: TradePlanReasonCode[];
  rejectionReasons: TradePlanRejectionCode[];
  limitations: TradePlanLimitationCode[];
  initialStatus: TradePlanStatus;
  executionQualification: ExecutionQualification;
  enteredIndex: number;
  entryPrice: number | null;
  finalStatus: TradePlanStatus;
  finalHealth: TradeHealthState;
  finalMfe: number;
  finalMae: number;
  highestTargetHit: 0 | 1 | 2 | 3;
  supersededIndex: number;
  terminalIndex: number;
  terminalRejection: TradePlanRejectionCode | null;
}

interface RuntimeTrack {
  planId: number;
}

interface TradeArrays {
  planId: Int32Array;
  status: Uint8Array;
  health: Uint8Array;
  mfe: Float32Array;
  mae: Float32Array;
  progressR: Float32Array;
  highestTarget: Uint8Array;
  primaryFamily: Int8Array;
}

export interface TradeManagementIndex {
  signalIndex: SignalDecisionIndex;
  arrays: TradeArrays;
  plans: PlanRecord[];
  settings: TradeManagementSettings;
  summary: TradeManagementSummary;
  latest: TradePlanSnapshot | null;
}

const cache = new WeakMap<object, TradeManagementIndex>();

function stable(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function countRecord<T extends string>(items: readonly T[]): Record<T, number> {
  return Object.fromEntries(items.map((item) => [item, 0])) as Record<T, number>;
}

function slotOf(candleIndex: number, familyIndex: number): number {
  return candleIndex * FAMILY_COUNT + familyIndex;
}

function actionFor(direction: Exclude<OpportunityDirection, "NEUTRAL">): Exclude<SignalAction, "NONE"> {
  return direction === "BULLISH" ? "BUY" : "SELL";
}

function isTerminal(status: TradePlanStatus): boolean {
  return status === "REJECTED" || status === "COMPLETED" || status === "EXPIRED" || status === "INVALIDATED" || status === "AMBIGUOUS_INTRABAR";
}

function qualificationForStatus(
  status: TradePlanStatus,
  initial: ExecutionQualification,
): ExecutionQualification {
  if (status === "NO_SIGNAL") return "NOT_EVALUATED";
  if (status === "REJECTED" || status === "EXPIRED" || status === "INVALIDATED" || status === "AMBIGUOUS_INTRABAR") {
    return "BLOCKED";
  }
  if (status === "COMPLETED") return "ANALYTICAL_ONLY";
  return initial;
}

function statusPriority(status: TradePlanStatus): number {
  switch (status) {
    case "ENTRY_VALID": return 100;
    case "ACTIVE": return 95;
    case "TARGET1_HIT": return 94;
    case "TARGET2_HIT": return 93;
    case "WAIT_ENTRY": return 85;
    case "COMPLETED": return 80;
    case "AMBIGUOUS_INTRABAR": return 70;
    case "INVALIDATED": return 60;
    case "REJECTED": return 50;
    case "EXPIRED": return 40;
    default: return 0;
  }
}

function averagePriorRange(prefixRange: Float64Array, index: number, lookback = 20): number {
  const start = Math.max(0, index - lookback);
  const count = index - start;
  if (count <= 0) return 0;
  return (prefixRange[index] - prefixRange[start]) / count;
}

function extreme(
  candles: readonly CompactCandle[],
  endIndex: number,
  lookback: number,
  field: 2 | 3,
  mode: "MIN" | "MAX",
): number {
  const start = Math.max(0, endIndex - lookback + 1);
  let value = mode === "MIN" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (let index = start; index <= endIndex; index += 1) {
    const next = candles[index][field];
    value = mode === "MIN" ? Math.min(value, next) : Math.max(value, next);
  }
  return value;
}

function familyExpiryBars(family: OpportunityFamily): number {
  if (family === "PRESSURE_RELEASE") return 2;
  if (family === "FAILED_BREAK_REVERSAL") return 3;
  if (family === "IMPULSE_RELOAD") return 4;
  return 3;
}

function structuralLookback(family: OpportunityFamily, feature: PriceBehaviour): number {
  if (family === "PRESSURE_RELEASE") return 5;
  if (family === "FAILED_BREAK_REVERSAL") return 10;
  if (family === "IMPULSE_RELOAD") return Math.max(5, Math.min(20, feature.pullbackBars + 3));
  return 7;
}

function expectedMovement(feature: PriceBehaviour, averageRange20: number): ExpectedMovementPlan {
  const efficiency = Math.max(0.2, Math.min(1, feature.efficiency5));
  const speedDistance5 = Math.abs(feature.speed5) * 5;
  const speedDistance10 = Math.abs(feature.speed10) * 10;
  const expected5 = Math.min(
    averageRange20 * TRADE_MANAGEMENT_CONFIG.expectedMovementMaximumAverageRanges,
    Math.max(averageRange20 * 1.25, speedDistance5 + averageRange20 * (1.15 + efficiency)),
  );
  const expected10 = Math.min(
    averageRange20 * TRADE_MANAGEMENT_CONFIG.expectedMovementMaximumAverageRanges,
    Math.max(expected5 * 1.35, speedDistance10 + averageRange20 * (1.8 + efficiency)),
  );
  const confidence = feature.noiseScore <= 30 && feature.efficiency5 >= 0.65
    ? "HIGH"
    : feature.noiseScore <= 55 && feature.efficiency5 >= 0.4
      ? "MEDIUM"
      : "LOW";
  return {
    expected5MinuteDistance: stable(expected5),
    expected10MinuteDistance: stable(expected10),
    expectedFirstProgressBars: confidence === "HIGH" ? 2 : confidence === "MEDIUM" ? 3 : 4,
    basisAverageRange20: stable(averageRange20),
    confidence,
  };
}

interface HistoricalObstacle {
  price: number;
  source: Exclude<TargetLevelSource, "R_MULTIPLE" | "EXPECTED_10M_CAPACITY" | "EXPANSION">;
}

const FIXED_TIMEFRAME_MS: Record<Exclude<Timeframe, "D1">, number> = {
  M1: MINUTE_MS,
  M5: 5 * MINUTE_MS,
  M15: 15 * MINUTE_MS,
  H1: 60 * MINUTE_MS,
};

function lastClosedIndexAtOrBefore(
  candles: readonly CompactCandle[],
  timeframe: Exclude<Timeframe, "D1">,
  maximumCloseTimestampMs: number,
): number {
  const durationMs = FIXED_TIMEFRAME_MS[timeframe];
  let low = 0;
  let high = candles.length - 1;
  let answer = NONE;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const closeTimestampMs = candles[middle][0] + durationMs;
    if (closeTimestampMs <= maximumCloseTimestampMs) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

function collectSwingObstacle(
  candidates: HistoricalObstacle[],
  candles: readonly CompactCandle[],
  completeness: TimeframeDataset["completeness"],
  lastClosedIndex: number,
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  entry: number,
  minimumDistance: number,
  lookback: number,
  source: HistoricalObstacle["source"],
): void {
  if (lastClosedIndex < 4) return;
  const start = Math.max(2, lastClosedIndex - lookback + 1);
  const finalSwingIndex = lastClosedIndex - 2;
  for (let index = start; index <= finalSwingIndex; index += 1) {
    let completeNeighborhood = true;
    for (let neighbour = index - 2; neighbour <= index + 2; neighbour += 1) {
      if (completeness[neighbour]?.status !== "COMPLETE") {
        completeNeighborhood = false;
        break;
      }
    }
    if (!completeNeighborhood) continue;
    if (direction === "BULLISH") {
      const value = candles[index][2];
      if (
        value > entry + minimumDistance &&
        value >= candles[index - 1][2] &&
        value >= candles[index - 2][2] &&
        value > candles[index + 1][2] &&
        value >= candles[index + 2][2]
      ) candidates.push({ price: value, source });
    } else {
      const value = candles[index][3];
      if (
        value < entry - minimumDistance &&
        value <= candles[index - 1][3] &&
        value <= candles[index - 2][3] &&
        value < candles[index + 1][3] &&
        value <= candles[index + 2][3]
      ) candidates.push({ price: value, source });
    }
  }
}

function collectRangeBoundary(
  candidates: HistoricalObstacle[],
  candles: readonly CompactCandle[],
  completeness: TimeframeDataset["completeness"],
  lastClosedIndex: number,
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  entry: number,
  minimumDistance: number,
  lookback: number,
  source: HistoricalObstacle["source"],
): void {
  if (lastClosedIndex < 0) return;
  const start = Math.max(0, lastClosedIndex - lookback + 1);
  let boundary = direction === "BULLISH" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (let index = start; index <= lastClosedIndex; index += 1) {
    if (completeness[index]?.status !== "COMPLETE") continue;
    boundary = direction === "BULLISH"
      ? Math.max(boundary, candles[index][2])
      : Math.min(boundary, candles[index][3]);
  }
  if (
    Number.isFinite(boundary) &&
    (direction === "BULLISH" ? boundary > entry + minimumDistance : boundary < entry - minimumDistance)
  ) candidates.push({ price: boundary, source });
}

function nearestHistoricalObstacle(
  datasets: Record<Timeframe, TimeframeDataset>,
  signalIndex: number,
  signalOpenTimestampMs: number,
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  entry: number,
  averageRange20: number,
): { nearest: HistoricalObstacle | null; candidateCount: number } {
  const minimumDistance = averageRange20 * 0.4;
  const candidates: HistoricalObstacle[] = [];

  collectSwingObstacle(
    candidates,
    datasets.M1.candles,
    datasets.M1.completeness,
    signalIndex - 1,
    direction,
    entry,
    minimumDistance,
    TRADE_MANAGEMENT_CONFIG.targetLookbackBars,
    "M1_SWING",
  );

  const higherTimeframes = [
    ["M5", 120, "M5_SWING"],
    ["M15", 80, "M15_SWING"],
    ["H1", 40, "H1_SWING"],
  ] as const;
  for (const [timeframe, lookback, source] of higherTimeframes) {
    const dataset = datasets[timeframe];
    const lastClosed = lastClosedIndexAtOrBefore(dataset.candles, timeframe, signalOpenTimestampMs);
    collectSwingObstacle(
      candidates,
      dataset.candles,
      dataset.completeness,
      lastClosed,
      direction,
      entry,
      minimumDistance,
      lookback,
      source,
    );
  }

  const m15LastClosed = lastClosedIndexAtOrBefore(datasets.M15.candles, "M15", signalOpenTimestampMs);
  collectRangeBoundary(
    candidates,
    datasets.M15.candles,
    datasets.M15.completeness,
    m15LastClosed,
    direction,
    entry,
    minimumDistance,
    20,
    "M15_RANGE_BOUNDARY",
  );
  const h1LastClosed = lastClosedIndexAtOrBefore(datasets.H1.candles, "H1", signalOpenTimestampMs);
  collectRangeBoundary(
    candidates,
    datasets.H1.candles,
    datasets.H1.completeness,
    h1LastClosed,
    direction,
    entry,
    minimumDistance,
    20,
    "H1_RANGE_BOUNDARY",
  );

  let nearest: HistoricalObstacle | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.price - entry);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { nearest, candidateCount: candidates.length };
}

function entryReference(
  family: OpportunityFamily,
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  candles: readonly CompactCandle[],
  signalIndex: number,
  feature: PriceBehaviour,
  averageRange20: number,
): number {
  const candle = candles[signalIndex];
  const open = candle[1];
  const close = candle[4];
  if (family === "PRESSURE_RELEASE") {
    return feature.breakLevel ?? close - (direction === "BULLISH" ? 1 : -1) * averageRange20 * 0.08;
  }
  if (family === "FAILED_BREAK_REVERSAL") {
    const reclaim = feature.breakLevel ?? close;
    return reclaim + (direction === "BULLISH" ? 1 : -1) * averageRange20 * 0.05;
  }
  if (family === "IMPULSE_RELOAD") {
    const lookback = Math.max(4, Math.min(20, feature.pullbackBars + 3));
    if (direction === "BULLISH") {
      const pullbackLow = extreme(candles, signalIndex, lookback, 3, "MIN");
      return pullbackLow + (close - pullbackLow) * 0.5;
    }
    const pullbackHigh = extreme(candles, signalIndex, lookback, 2, "MAX");
    return pullbackHigh - (pullbackHigh - close) * 0.5;
  }
  const correctionOffset = averageRange20 * 0.12;
  const rotationReference = (open + close) / 2;
  return rotationReference - (direction === "BULLISH" ? 1 : -1) * correctionOffset;
}

function familyEntryHalfWidth(family: OpportunityFamily, averageRange20: number): number {
  const factor = family === "PRESSURE_RELEASE"
    ? 0.18
    : family === "FAILED_BREAK_REVERSAL"
      ? 0.2
      : family === "IMPULSE_RELOAD"
        ? 0.25
        : 0.2;
  return Math.max(averageRange20 * factor, 0.01);
}

function familyNoChaseDistance(family: OpportunityFamily, averageRange20: number, width: number): number {
  const factor = family === "PRESSURE_RELEASE"
    ? 0.7
    : family === "FAILED_BREAK_REVERSAL"
      ? 0.8
      : family === "IMPULSE_RELOAD"
        ? 0.9
        : 0.75;
  return Math.max(averageRange20 * factor, width * 2.5);
}

function buildStaticPlan(
  datasets: Record<Timeframe, TimeframeDataset>,
  signalIndex: number,
  familyIndex: number,
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  candidateScore: number,
  feature: PriceBehaviour,
  averageRange20: number,
  planId: number,
  settings: TradeManagementSettings,
): PlanRecord {
  const family = SIGNAL_OPPORTUNITY_FAMILIES[familyIndex];
  const candles = datasets.M1.candles;
  const completeness = datasets.M1.completeness;
  const candle = candles[signalIndex];
  const signalTimestampMs = candle[0] + MINUTE_MS;
  const reasons: TradePlanReasonCode[] = [
    "PHASE6_CONFIRMED",
    "FAMILY_SPECIFIC_ENTRY",
    "NO_CHASE_LIMIT_DEFINED",
    "EXPIRY_DEFINED",
    "EXPECTED_MOVEMENT_ESTIMATED",
  ];
  const rejectionReasons: TradePlanRejectionCode[] = [];
  const limitations: TradePlanLimitationCode[] = [...LIMITATIONS];
  const width = familyEntryHalfWidth(family, averageRange20);
  const preferred = entryReference(family, direction, candles, signalIndex, feature, averageRange20);
  const lower = stable(preferred - width);
  const upper = stable(preferred + width);
  const expiryBars = familyExpiryBars(family);
  const noChaseDistance = familyNoChaseDistance(family, averageRange20, width);
  const noChasePrice = stable(preferred + (direction === "BULLISH" ? noChaseDistance : -noChaseDistance));
  const entryZone: EntryZone = {
    lower,
    upper,
    preferred: stable(preferred),
    noChasePrice,
    validForBars: expiryBars,
    expiresAtMs: signalTimestampMs + expiryBars * MINUTE_MS,
  };

  const lookback = structuralLookback(family, feature);
  const protectedExtreme = direction === "BULLISH"
    ? extreme(candles, signalIndex, lookback, 3, "MIN")
    : extreme(candles, signalIndex, lookback, 2, "MAX");
  const buffer = Math.max(averageRange20 * TRADE_MANAGEMENT_CONFIG.safetyBufferAverageRange, 0.01);
  const stopLossPrice = stable(protectedExtreme + (direction === "BULLISH" ? -buffer : buffer));
  const riskDistance = stable(Math.abs(preferred - stopLossPrice));
  const riskInAverageRanges = averageRange20 > 0 ? riskDistance / averageRange20 : Number.POSITIVE_INFINITY;
  const executionCost = Math.max(0, settings.assumedSpreadPrice + settings.assumedSlippagePrice);
  const totalRiskWithCosts = riskDistance + executionCost;
  const structuralRisk: StructuralRiskPlan = {
    invalidationPrice: stable(protectedExtreme),
    stopLossPrice,
    safetyBuffer: stable(buffer),
    riskDistance,
    estimatedExecutionCost: stable(executionCost),
    totalRiskWithCosts: stable(totalRiskWithCosts),
    riskInAverageRanges: stable(riskInAverageRanges),
  };
  reasons.push("STRUCTURAL_INVALIDATION_DEFINED");

  const requiredCompleteLookback = Math.max(20, lookback);
  const completenessStart = Math.max(0, signalIndex - requiredCompleteLookback + 1);
  for (let index = completenessStart; index <= signalIndex; index += 1) {
    if (completeness[index]?.status !== "COMPLETE") {
      rejectionReasons.push("PARTIAL_SOURCE_DATA");
      break;
    }
  }
  if (!(lower <= preferred && preferred <= upper)) rejectionReasons.push("INVALID_ENTRY_ZONE");
  if (
    (direction === "BULLISH" && stopLossPrice >= lower) ||
    (direction === "BEARISH" && stopLossPrice <= upper)
  ) rejectionReasons.push("INVALID_STRUCTURAL_STOP");
  if (riskInAverageRanges < TRADE_MANAGEMENT_CONFIG.minimumRiskInAverageRanges) rejectionReasons.push("STOP_DISTANCE_TOO_SMALL");
  if (riskInAverageRanges > settings.maximumRiskInAverageRanges) rejectionReasons.push("STOP_DISTANCE_TOO_WIDE");

  const obstacleResult = nearestHistoricalObstacle(
    datasets,
    signalIndex,
    candle[0],
    direction,
    preferred,
    averageRange20,
  );
  const obstacle = obstacleResult.nearest;
  const expected = expectedMovement(feature, averageRange20);
  const obstacleDistance = obstacle === null ? null : Math.abs(obstacle.price - preferred);
  const availableDistance = obstacleDistance === null
    ? expected.expected10MinuteDistance
    : Math.min(obstacleDistance, expected.expected10MinuteDistance);
  const limitingFactor = obstacleDistance !== null && obstacleDistance <= expected.expected10MinuteDistance
    ? "HISTORICAL_OBSTACLE" as const
    : "EXPECTED_10M_CAPACITY" as const;
  const availableRiskReward = totalRiskWithCosts > 0
    ? Math.max(0, availableDistance - executionCost) / totalRiskWithCosts
    : 0;
  if (availableRiskReward < settings.minimumRiskReward) {
    rejectionReasons.push("TARGET_SPACE_INSUFFICIENT", "RR_BELOW_MINIMUM");
  } else {
    reasons.push("TARGET_SPACE_AVAILABLE", "MINIMUM_RR_PASSED");
  }

  const sign = direction === "BULLISH" ? 1 : -1;
  const targets: TradeTarget[] = [];
  const target1Distance = settings.minimumRiskReward * totalRiskWithCosts + executionCost;
  targets.push({
    name: "TP1",
    price: stable(preferred + sign * target1Distance),
    rewardDistance: stable(target1Distance),
    riskReward: stable((target1Distance - executionCost) / totalRiskWithCosts),
    source: "R_MULTIPLE",
  });
  const target2Distance = Math.min(availableDistance * 0.92, riskDistance * 2.5);
  if (target2Distance > target1Distance * 1.05) {
    targets.push({
      name: "TP2",
      price: stable(preferred + sign * target2Distance),
      rewardDistance: stable(target2Distance),
      riskReward: stable(Math.max(0, target2Distance - executionCost) / totalRiskWithCosts),
      source: limitingFactor === "HISTORICAL_OBSTACLE"
        ? obstacle?.source ?? "EXPECTED_10M_CAPACITY"
        : "EXPECTED_10M_CAPACITY",
    });
  }
  const target3Distance = Math.min(availableDistance * 0.98, riskDistance * 3.5);
  if (targets.some((target) => target.name === "TP2") && target3Distance > target2Distance * 1.08 && availableRiskReward >= 3) {
    targets.push({
      name: "TP3",
      price: stable(preferred + sign * target3Distance),
      rewardDistance: stable(target3Distance),
      riskReward: stable(Math.max(0, target3Distance - executionCost) / totalRiskWithCosts),
      source: limitingFactor === "HISTORICAL_OBSTACLE"
        ? obstacle?.source ?? "EXPANSION"
        : "EXPANSION",
    });
  }
  const targetSpace: TargetSpacePlan = {
    nearestObstaclePrice: obstacle === null ? null : stable(obstacle.price),
    nearestObstacleSource: obstacle?.source ?? null,
    obstacleDistance: obstacleDistance === null ? null : stable(obstacleDistance),
    expected10MinuteCapacity: stable(expected.expected10MinuteDistance),
    limitingFactor,
    obstacleCandidatesEvaluated: obstacleResult.candidateCount,
    usedExpansionFallback: obstacle === null,
    availableDistance: stable(availableDistance),
    availableRiskReward: stable(availableRiskReward),
    targets,
  };

  const close = candle[4];
  const beyondNoChase = direction === "BULLISH" ? close > noChasePrice : close < noChasePrice;
  if (beyondNoChase) rejectionReasons.push("ENTRY_ALREADY_LATE");
  const inside = close >= lower && close <= upper;
  if (inside) reasons.push("ENTRY_INSIDE_ZONE");
  else reasons.push("ENTRY_WAITING_RETEST");

  const initialStatus: TradePlanStatus = rejectionReasons.length > 0
    ? "REJECTED"
    : inside
      ? "ENTRY_VALID"
      : "WAIT_ENTRY";

  return {
    id: planId,
    planId: `${family}:${direction}:${signalTimestampMs}`,
    family,
    familyIndex,
    direction,
    action: actionFor(direction),
    signalIndex,
    signalTimestampMs,
    candidateScore,
    settings,
    executionCosts: {
      assumedSpreadPrice: stable(settings.assumedSpreadPrice),
      assumedSlippagePrice: stable(settings.assumedSlippagePrice),
      totalEstimatedCost: stable(executionCost),
      liveVerified: false,
      source: "USER_CONFIGURED_HISTORICAL_ASSUMPTION",
    },
    entryZone,
    structuralRisk,
    targetSpace,
    expectedMovement: expected,
    reasons,
    rejectionReasons: [...new Set(rejectionReasons)],
    limitations,
    initialStatus,
    executionQualification: initialStatus === "REJECTED" ? "BLOCKED" : "QUALIFIED_CANDLE_DATA",
    enteredIndex: NONE,
    entryPrice: null,
    finalStatus: initialStatus,
    finalHealth: "NOT_ACTIVE",
    finalMfe: 0,
    finalMae: 0,
    highestTargetHit: 0,
    supersededIndex: NONE,
    terminalIndex: initialStatus === "REJECTED" ? signalIndex : NONE,
    terminalRejection: null,
  };
}

function targetPrice(plan: PlanRecord, name: "TP1" | "TP2" | "TP3"): number | null {
  return plan.targetSpace.targets.find((target) => target.name === name)?.price ?? null;
}

function filledExecutionMetrics(plan: PlanRecord): FilledExecutionMetrics | null {
  if (plan.entryPrice === null) return null;
  const tp1 = targetPrice(plan, "TP1");
  if (tp1 === null) return null;
  const actualRiskDistance = Math.abs(plan.entryPrice - plan.structuralRisk.stopLossPrice);
  const actualTotalRiskWithCosts = actualRiskDistance + plan.executionCosts.totalEstimatedCost;
  const rewardDistance = Math.abs(tp1 - plan.entryPrice);
  const actualRiskRewardToTp1 = actualTotalRiskWithCosts > 0
    ? Math.max(0, rewardDistance - plan.executionCosts.totalEstimatedCost) / actualTotalRiskWithCosts
    : 0;
  return {
    actualRiskDistance: stable(actualRiskDistance),
    actualTotalRiskWithCosts: stable(actualTotalRiskWithCosts),
    actualRiskRewardToTp1: stable(actualRiskRewardToTp1),
  };
}

function effectiveRiskWithCosts(plan: PlanRecord): number {
  return filledExecutionMetrics(plan)?.actualTotalRiskWithCosts ?? plan.structuralRisk.totalRiskWithCosts;
}

function targetTouched(candle: CompactCandle, direction: PlanRecord["direction"], price: number | null): boolean {
  if (price === null) return false;
  return direction === "BULLISH" ? candle[2] >= price : candle[3] <= price;
}

function protectiveStopPrice(plan: PlanRecord): number {
  if (plan.highestTargetHit >= 2) {
    return targetPrice(plan, "TP1") ?? plan.entryPrice ?? plan.entryZone.preferred;
  }
  if (plan.highestTargetHit >= 1) return plan.entryPrice ?? plan.entryZone.preferred;
  return plan.structuralRisk.stopLossPrice;
}

function stopTouched(candle: CompactCandle, plan: PlanRecord): boolean {
  const stop = protectiveStopPrice(plan);
  return plan.direction === "BULLISH" ? candle[3] <= stop : candle[2] >= stop;
}

function entryTouched(candle: CompactCandle, zone: EntryZone): boolean {
  return candle[3] <= zone.upper && candle[2] >= zone.lower;
}

function chooseEntryPrice(candle: CompactCandle, zone: EntryZone): number {
  return stable(Math.max(zone.lower, Math.min(zone.upper, Math.max(candle[3], Math.min(candle[2], zone.preferred)))));
}

function updatePlan(plan: PlanRecord, candle: CompactCandle, candleIndex: number): void {
  if (isTerminal(plan.finalStatus)) return;
  const barsSinceSignal = candleIndex - plan.signalIndex;

  if (plan.enteredIndex === NONE) {
    if (barsSinceSignal > plan.entryZone.validForBars) {
      plan.finalStatus = "EXPIRED";
      plan.finalHealth = "NOT_ACTIVE";
      plan.terminalIndex = candleIndex;
      plan.terminalRejection = "SIGNAL_EXPIRED";
      return;
    }

    const entryHit = entryTouched(candle, plan.entryZone);
    const stopHit = stopTouched(candle, plan);
    const tp1Hit = targetTouched(candle, plan.direction, targetPrice(plan, "TP1"));
    const noChaseHit = plan.direction === "BULLISH"
      ? candle[2] >= plan.entryZone.noChasePrice
      : candle[3] <= plan.entryZone.noChasePrice;

    // OHLC cannot reveal whether the zone or the stop/target/no-chase level traded first.
    if (entryHit && (stopHit || tp1Hit || noChaseHit)) {
      plan.finalStatus = "AMBIGUOUS_INTRABAR";
      plan.finalHealth = "AMBIGUOUS";
      plan.terminalIndex = candleIndex;
      plan.terminalRejection = "INTRABAR_SEQUENCE_UNKNOWN";
      return;
    }
    if (!entryHit && stopHit) {
      plan.finalStatus = "INVALIDATED";
      plan.finalHealth = "INVALIDATED";
      plan.terminalIndex = candleIndex;
      plan.terminalRejection = "STRUCTURE_INVALIDATED";
      return;
    }
    if (!entryHit && (noChaseHit || tp1Hit)) {
      plan.finalStatus = "EXPIRED";
      plan.finalHealth = "NOT_ACTIVE";
      plan.terminalIndex = candleIndex;
      plan.terminalRejection = "ENTRY_ALREADY_LATE";
      return;
    }
    if (candleIndex > plan.signalIndex && entryHit) {
      plan.enteredIndex = candleIndex;
      plan.entryPrice = chooseEntryPrice(candle, plan.entryZone);
      plan.finalStatus = "ACTIVE";
      plan.finalHealth = "HEALTHY";
      // Entry occurs somewhere inside this OHLC bar. Its other extremes may have happened
      // before the fill, so MFE/MAE starts from the next fully-known candle.
      return;
    }

    plan.finalStatus = candle[4] >= plan.entryZone.lower && candle[4] <= plan.entryZone.upper
      ? "ENTRY_VALID"
      : "WAIT_ENTRY";
    return;
  }

  const entry = plan.entryPrice ?? plan.entryZone.preferred;
  const favourable = plan.direction === "BULLISH" ? candle[2] - entry : entry - candle[3];
  const adverse = plan.direction === "BULLISH" ? entry - candle[3] : candle[2] - entry;
  plan.finalMfe = Math.max(plan.finalMfe, favourable, 0);
  plan.finalMae = Math.max(plan.finalMae, adverse, 0);

  const stop = stopTouched(candle, plan);
  const tp1 = targetTouched(candle, plan.direction, targetPrice(plan, "TP1"));
  const tp2 = targetTouched(candle, plan.direction, targetPrice(plan, "TP2"));
  const tp3 = targetTouched(candle, plan.direction, targetPrice(plan, "TP3"));
  if (stop && (tp1 || tp2 || tp3)) {
    plan.finalStatus = "AMBIGUOUS_INTRABAR";
    plan.finalHealth = "AMBIGUOUS";
    plan.terminalIndex = candleIndex;
    plan.terminalRejection = "INTRABAR_SEQUENCE_UNKNOWN";
    return;
  }
  if (stop) {
    plan.finalStatus = "INVALIDATED";
    plan.finalHealth = "INVALIDATED";
    plan.terminalIndex = candleIndex;
    plan.terminalRejection = "STRUCTURE_INVALIDATED";
    return;
  }
  if (tp3) {
    plan.highestTargetHit = 3;
    plan.finalStatus = "COMPLETED";
    plan.finalHealth = "TARGET_PROGRESS";
    plan.terminalIndex = candleIndex;
    return;
  }
  if (tp2) {
    plan.highestTargetHit = Math.max(plan.highestTargetHit, 2) as 0 | 1 | 2 | 3;
    plan.finalHealth = "TARGET_PROGRESS";
    if (targetPrice(plan, "TP3") === null) {
      plan.finalStatus = "COMPLETED";
      plan.terminalIndex = candleIndex;
    } else {
      plan.finalStatus = "TARGET2_HIT";
    }
    return;
  }
  if (tp1) {
    plan.highestTargetHit = Math.max(plan.highestTargetHit, 1) as 0 | 1 | 2 | 3;
    plan.finalHealth = "TARGET_PROGRESS";
    if (targetPrice(plan, "TP2") === null) {
      plan.finalStatus = "COMPLETED";
      plan.terminalIndex = candleIndex;
    } else {
      plan.finalStatus = "TARGET1_HIT";
    }
    return;
  }

  if (plan.highestTargetHit >= 2) {
    plan.finalStatus = "TARGET2_HIT";
    plan.finalHealth = "TARGET_PROGRESS";
    return;
  }
  if (plan.highestTargetHit >= 1) {
    plan.finalStatus = "TARGET1_HIT";
    plan.finalHealth = "TARGET_PROGRESS";
    return;
  }

  const risk = Math.max(effectiveRiskWithCosts(plan), 1e-9);
  const closeProgress = plan.direction === "BULLISH" ? candle[4] - entry : entry - candle[4];
  const barsSinceEntry = candleIndex - plan.enteredIndex;
  if (closeProgress <= -0.25 * risk) {
    plan.finalHealth = "WEAKENING";
  } else if (barsSinceEntry >= plan.expectedMovement.expectedFirstProgressBars && plan.finalMfe < 0.35 * risk) {
    plan.finalHealth = "STALLED";
  } else {
    plan.finalHealth = "HEALTHY";
  }
  plan.finalStatus = "ACTIVE";
}

function allocateArrays(samples: number): TradeArrays {
  const slots = samples * FAMILY_COUNT;
  const planId = new Int32Array(slots);
  planId.fill(NONE);
  const primaryFamily = new Int8Array(samples);
  primaryFamily.fill(NONE);
  return {
    planId,
    status: new Uint8Array(slots),
    health: new Uint8Array(slots),
    mfe: new Float32Array(slots),
    mae: new Float32Array(slots),
    progressR: new Float32Array(slots),
    highestTarget: new Uint8Array(slots),
    primaryFamily,
  };
}

function writeTrack(arrays: TradeArrays, candleIndex: number, familyIndex: number, plan: PlanRecord | null): void {
  const slot = slotOf(candleIndex, familyIndex);
  if (!plan) {
    arrays.status[slot] = STATUS_CODE.get("NO_SIGNAL") ?? 0;
    arrays.health[slot] = HEALTH_CODE.get("NOT_ACTIVE") ?? 0;
    return;
  }
  arrays.planId[slot] = plan.id;
  arrays.status[slot] = STATUS_CODE.get(plan.finalStatus) ?? 0;
  arrays.health[slot] = HEALTH_CODE.get(plan.finalHealth) ?? 0;
  arrays.mfe[slot] = plan.finalMfe;
  arrays.mae[slot] = plan.finalMae;
  const effectiveRisk = effectiveRiskWithCosts(plan);
  arrays.progressR[slot] = effectiveRisk > 0 ? plan.finalMfe / effectiveRisk : 0;
  arrays.highestTarget[slot] = plan.highestTargetHit;
}

function dynamicReasonsFor(status: TradePlanStatus, health: TradeHealthState, entered: boolean, highestTarget: number): TradePlanReasonCode[] {
  const reasons: TradePlanReasonCode[] = [];
  if (entered) reasons.push("ENTRY_TOUCHED");
  if (highestTarget >= 1) reasons.push("TP1_REACHED");
  if (highestTarget >= 2) reasons.push("TP2_REACHED");
  if (highestTarget >= 3) reasons.push("TP3_REACHED");
  if (status === "INVALIDATED") reasons.push("STOP_REACHED");
  if (health === "HEALTHY") reasons.push("THESIS_PROGRESSING");
  if (health === "STALLED") reasons.push("THESIS_STALLED");
  if (health === "WEAKENING") reasons.push("THESIS_WEAKENING");
  return reasons;
}

function dynamicRejectionsFor(
  status: TradePlanStatus,
  terminalRejection: TradePlanRejectionCode | null,
): TradePlanRejectionCode[] {
  if (status === "EXPIRED") return [terminalRejection ?? "SIGNAL_EXPIRED"];
  if (status === "INVALIDATED") return [terminalRejection ?? "STRUCTURE_INVALIDATED"];
  if (status === "AMBIGUOUS_INTRABAR") return [terminalRejection ?? "INTRABAR_SEQUENCE_UNKNOWN"];
  return [];
}

function snapshotForPlan(
  index: TradeManagementIndex,
  candleIndex: number,
  familyIndex: number,
): TradePlanSnapshot | null {
  const slot = slotOf(candleIndex, familyIndex);
  const planId = index.arrays.planId[slot];
  if (planId < 0) return null;
  const plan = index.plans[planId];
  if (!plan) return null;
  const status = STATUSES[index.arrays.status[slot]] ?? "NO_SIGNAL";
  const health = HEALTH_STATES[index.arrays.health[slot]] ?? "NOT_ACTIVE";
  const timestampMs = index.signalIndex.stateIndex.datasets.M1.candles[candleIndex][0] + MINUTE_MS;
  const entered = plan.enteredIndex >= 0 && plan.enteredIndex <= candleIndex;
  const highestTarget = index.arrays.highestTarget[slot];
  const currentProtectiveStopPrice = highestTarget >= 2
    ? targetPrice(plan, "TP1") ?? plan.entryPrice ?? plan.entryZone.preferred
    : highestTarget >= 1
      ? plan.entryPrice ?? plan.entryZone.preferred
      : plan.structuralRisk.stopLossPrice;
  const managementAction = status === "WAIT_ENTRY"
    ? "WAIT"
    : status === "ENTRY_VALID"
      ? "ENTER_IN_ZONE"
      : status === "TARGET1_HIT"
        ? "MOVE_STOP_TO_BREAK_EVEN"
        : status === "TARGET2_HIT"
          ? "TRAIL_STOP_TO_TP1"
          : status === "INVALIDATED" || status === "AMBIGUOUS_INTRABAR"
            ? "EXIT"
            : status === "ACTIVE"
              ? "HOLD"
              : "NO_ACTION";
  return {
    timestampMs,
    planId: plan.planId,
    family: plan.family,
    direction: plan.direction,
    action: plan.action,
    status,
    health,
    executionQualification: qualificationForStatus(status, plan.executionQualification),
    signalTimestampMs: plan.signalTimestampMs,
    enteredAtMs: entered
      ? index.signalIndex.stateIndex.datasets.M1.candles[plan.enteredIndex][0] + MINUTE_MS
      : null,
    entryPrice: entered ? plan.entryPrice : null,
    entryZone: plan.entryZone,
    structuralRisk: plan.structuralRisk,
    targetSpace: plan.targetSpace,
    expectedMovement: plan.expectedMovement,
    filledExecution: entered ? filledExecutionMetrics(plan) : null,
    executionCosts: plan.executionCosts,
    currentProtectiveStopPrice: stable(currentProtectiveStopPrice),
    managementAction,
    barsSinceSignal: Math.max(0, candleIndex - plan.signalIndex),
    barsSinceEntry: entered ? Math.max(0, candleIndex - plan.enteredIndex) : 0,
    maximumFavourableExcursion: stable(index.arrays.mfe[slot]),
    maximumAdverseExcursion: stable(index.arrays.mae[slot]),
    progressInRiskUnits: stable(index.arrays.progressR[slot]),
    reasons: [...new Set([...plan.reasons, ...dynamicReasonsFor(status, health, entered, highestTarget)])],
    rejectionReasons: [...new Set([
      ...plan.rejectionReasons,
      ...dynamicRejectionsFor(
        status,
        plan.terminalIndex >= 0 && plan.terminalIndex <= candleIndex ? plan.terminalRejection : null,
      ),
    ])],
    limitations: [...plan.limitations],
    positionSizing: {
      status: "BROKER_CONTRACT_REQUIRED",
      message: "Lot size is not calculated because broker contract size, tick value, account equity and allowed risk were not supplied.",
    },
    semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION",
  };
}

function primarySnapshotAtIndex(index: TradeManagementIndex, candleIndex: number): TradePlanSnapshot | null {
  const preferred = index.arrays.primaryFamily[candleIndex];
  if (preferred >= 0) return snapshotForPlan(index, candleIndex, preferred);
  let best: TradePlanSnapshot | null = null;
  for (let familyIndex = 0; familyIndex < FAMILY_COUNT; familyIndex += 1) {
    const candidate = snapshotForPlan(index, candleIndex, familyIndex);
    if (!candidate) continue;
    if (!best || statusPriority(candidate.status) > statusPriority(best.status)) best = candidate;
  }
  return best;
}

function eventFromPlan(plan: PlanRecord, status = plan.initialStatus): TradePlanEvent {
  const tp1 = plan.targetSpace.targets[0];
  const tp2 = plan.targetSpace.targets.find((target) => target.name === "TP2");
  return {
    timestampMs: plan.signalTimestampMs,
    planId: plan.planId,
    family: plan.family,
    direction: plan.direction,
    action: plan.action,
    status,
    entryPrice: plan.entryPrice,
    stopLossPrice: plan.structuralRisk.stopLossPrice,
    tp1Price: tp1.price,
    tp2Price: tp2?.price ?? null,
    candidateScore: plan.candidateScore,
    riskRewardToTp1: filledExecutionMetrics(plan)?.actualRiskRewardToTp1 ?? tp1.riskReward,
  };
}

function buildIndex(signalIndex: SignalDecisionIndex, settings: TradeManagementSettings): TradeManagementIndex {
  const m1 = signalIndex.stateIndex.datasets.M1;
  const candles = m1.candles;
  const arrays = allocateArrays(candles.length);
  const runtimes: RuntimeTrack[] = SIGNAL_OPPORTUNITY_FAMILIES.map(() => ({ planId: NONE }));
  const plans: PlanRecord[] = [];
  const statusCounts = countRecord(STATUSES);
  const rejectionReasonCounts = countRecord(REJECTIONS);
  const limitationCounts = countRecord(LIMITATIONS);
  const strongest = new FixedMinHeap<TradePlanEvent>(
    TRADE_MANAGEMENT_CONFIG.strongestPlanLimit,
    (event) => event.candidateScore + Math.min(20, event.riskRewardToTp1 * 5),
  );
  const recentEvents: TradePlanEvent[] = [];
  const prefixRange = new Float64Array(candles.length + 1);
  for (let index = 0; index < candles.length; index += 1) {
    prefixRange[index + 1] = prefixRange[index] + candles[index][2] - candles[index][3];
  }

  let createdPlanCount = 0;
  let qualifiedPlanCount = 0;
  let rejectedPlanCount = 0;
  let enteredPlanCount = 0;
  let expiredPlanCount = 0;
  let invalidatedPlanCount = 0;
  let ambiguousPlanCount = 0;
  let tp1HitCount = 0;
  let tp2HitCount = 0;
  let completedPlanCount = 0;
  let riskTotal = 0;
  let rrTotal = 0;
  let qualifiedSamples = 0;
  let barsToEntryTotal = 0;
  let barsToEntrySamples = 0;

  forEachPriceBehaviour(candles, (feature, candleIndex) => {
    const priorAverageRange20 = averagePriorRange(prefixRange, candleIndex, 20);
    const averageRange20 = Math.max(
      priorAverageRange20 > 0 ? priorAverageRange20 : candles[candleIndex][2] - candles[candleIndex][3],
      0.01,
    );
    let primaryFamily = NONE;
    let primaryPriority = -1;

    for (let familyIndex = 0; familyIndex < FAMILY_COUNT; familyIndex += 1) {
      const signal = signalTrackStateAtIndex(signalIndex, candleIndex, familyIndex);
      const runtime = runtimes[familyIndex];
      let plan = runtime.planId >= 0 ? plans[runtime.planId] : null;

      const isNewConfirmation = signal?.isNewEvent === true &&
        (signal.lifecycle === "CONFIRMED" || signal.lifecycle === "CONTINUATION") &&
        signal.direction !== "NEUTRAL";

      if (isNewConfirmation && signal) {
        if (plan && !isTerminal(plan.finalStatus)) {
          plan.finalStatus = "INVALIDATED";
          plan.finalHealth = "INVALIDATED";
          plan.terminalIndex = candleIndex;
          plan.supersededIndex = candleIndex;
          plan.terminalRejection = "SUPERSEDED_BY_NEW_SIGNAL";
          invalidatedPlanCount += 1;
        }
        plan = buildStaticPlan(
          signalIndex.stateIndex.datasets,
          candleIndex,
          familyIndex,
          signal.direction as Exclude<OpportunityDirection, "NEUTRAL">,
          signal.candidateScore,
          feature,
          averageRange20,
          plans.length,
          settings,
        );
        if (signal.lifecycle === "CONTINUATION") {
          plan.reasons = plan.reasons.filter((reason) => reason !== "PHASE6_CONFIRMED");
          plan.reasons.unshift("PHASE6_CONTINUATION");
        }
        plans.push(plan);
        runtime.planId = plan.id;
        createdPlanCount += 1;
        riskTotal += plan.structuralRisk.riskDistance;
        rrTotal += plan.targetSpace.targets[0]?.riskReward ?? 0;
        if (plan.initialStatus === "REJECTED") rejectedPlanCount += 1;
        else {
          qualifiedPlanCount += 1;
          qualifiedSamples += 1;
        }
        const event = eventFromPlan(plan);
        strongest.push(event);
        recentEvents.push(event);
        if (recentEvents.length > 30) recentEvents.shift();
      } else if (plan) {
        updatePlan(plan, candles[candleIndex], candleIndex);
      }

      if (plan && isTerminal(plan.finalStatus) && plan.terminalIndex >= 0 && candleIndex - plan.terminalIndex > TRADE_MANAGEMENT_CONFIG.terminalDisplayBars) {
        runtime.planId = NONE;
        plan = null;
      }

      if (plan) {
        const priorStatus = candleIndex > 0
          ? STATUSES[arrays.status[slotOf(candleIndex - 1, familyIndex)]] ?? "NO_SIGNAL"
          : "NO_SIGNAL";
        if (plan.enteredIndex === candleIndex) {
          enteredPlanCount += 1;
          barsToEntryTotal += candleIndex - plan.signalIndex;
          barsToEntrySamples += 1;
        }
        if (plan.finalStatus !== priorStatus) {
          if (plan.finalStatus === "EXPIRED") expiredPlanCount += 1;
          if (plan.finalStatus === "INVALIDATED") invalidatedPlanCount += 1;
          if (plan.finalStatus === "AMBIGUOUS_INTRABAR") ambiguousPlanCount += 1;
          if (plan.finalStatus === "TARGET1_HIT") tp1HitCount += 1;
          if (plan.finalStatus === "TARGET2_HIT") tp2HitCount += 1;
          if (plan.finalStatus === "COMPLETED") completedPlanCount += 1;
        }
      }

      writeTrack(arrays, candleIndex, familyIndex, plan);
      const status = plan?.finalStatus ?? "NO_SIGNAL";
      const priority = statusPriority(status) + (plan?.candidateScore ?? 0) / 100;
      if (priority > primaryPriority) {
        primaryPriority = priority;
        primaryFamily = plan ? familyIndex : primaryFamily;
      }
    }

    arrays.primaryFamily[candleIndex] = primaryFamily;
    const primaryStatus = primaryFamily >= 0
      ? STATUSES[arrays.status[slotOf(candleIndex, primaryFamily)]] ?? "NO_SIGNAL"
      : "NO_SIGNAL";
    statusCounts[primaryStatus] += 1;
  });

  for (const plan of plans) {
    for (const reason of new Set([
      ...plan.rejectionReasons,
      ...dynamicRejectionsFor(plan.finalStatus, plan.terminalRejection),
    ])) {
      rejectionReasonCounts[reason] += 1;
    }
    for (const limitation of new Set(plan.limitations)) limitationCounts[limitation] += 1;
  }

  const summary: TradeManagementSummary = {
    sampleCount: candles.length,
    createdPlanCount,
    qualifiedPlanCount,
    rejectedPlanCount,
    enteredPlanCount,
    expiredPlanCount,
    invalidatedPlanCount,
    ambiguousPlanCount,
    tp1HitCount,
    tp2HitCount,
    completedPlanCount,
    statusCounts,
    rejectionReasonCounts,
    limitationCounts,
    averageRiskDistance: createdPlanCount > 0 ? stable(riskTotal / createdPlanCount) : 0,
    averageTp1RiskReward: createdPlanCount > 0 ? stable(rrTotal / createdPlanCount) : 0,
    averageBarsToEntry: barsToEntrySamples > 0 ? stable(barsToEntryTotal / barsToEntrySamples) : 0,
    strongestPlans: strongest.toDescendingArray(),
    recentEvents: [...recentEvents],
  };
  const index: TradeManagementIndex = { signalIndex, arrays, plans, settings, summary, latest: null };
  index.latest = candles.length > 0 ? primarySnapshotAtIndex(index, candles.length - 1) : null;
  return index;
}

export function createTradeManagementIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: TradeManagementBuildOptions,
): TradeManagementIndex {
  const settings = resolveSettings(options.settings);
  return buildIndex(getOrCreateSignalDecisionIndex(datasets, options), settings);
}

export function getOrCreateTradeManagementIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: TradeManagementBuildOptions,
): TradeManagementIndex {
  const settings = resolveSettings(options.settings);
  const existing = cache.get(datasets);
  if (
    existing &&
    existing.signalIndex.stateIndex.dailyBoundaryMode === options.dailyBoundaryMode &&
    JSON.stringify(existing.settings) === JSON.stringify(settings)
  ) return existing;
  const created = createTradeManagementIndex(datasets, { ...options, settings });
  cache.set(datasets, created);
  return created;
}

export function analyzeTradeManagementAt(
  index: TradeManagementIndex,
  anchorTimestampMs: number,
): TradePlanSnapshot | null {
  const candleIndex = signalCandleIndexAtOrBefore(index.signalIndex, anchorTimestampMs);
  return candleIndex < 0 ? null : primarySnapshotAtIndex(index, candleIndex);
}

export function createTradePlanHistory(
  index: TradeManagementIndex,
  analysisId: string,
  requestedOffset: number,
  requestedLimit: number,
  maximumLimit = 5_000,
): TradePlanHistoryResponse {
  const total = index.plans.length;
  const limit = Math.max(1, Math.min(maximumLimit, Math.floor(requestedLimit)));
  const maximumOffset = Math.max(0, total - limit);
  const offset = Math.max(0, Math.min(maximumOffset, Math.floor(requestedOffset)));
  const end = Math.min(total, offset + limit);
  const candles = index.signalIndex.stateIndex.datasets.M1.candles;
  const items: TradePlanHistoryItem[] = index.plans.slice(offset, end).map((plan) => ({
    ...eventFromPlan(plan, plan.finalStatus),
    signalTimestampMs: plan.signalTimestampMs,
    enteredAtMs: plan.enteredIndex >= 0
      ? candles[plan.enteredIndex][0] + MINUTE_MS
      : null,
    finalHealth: plan.finalHealth,
    maximumFavourableExcursion: stable(plan.finalMfe),
    maximumAdverseExcursion: stable(plan.finalMae),
    highestTargetHit: plan.highestTargetHit,
    entryZone: plan.entryZone,
    structuralRisk: plan.structuralRisk,
    targetSpace: plan.targetSpace,
    expectedMovement: plan.expectedMovement,
    filledExecution: filledExecutionMetrics(plan),
    executionCosts: plan.executionCosts,
    reasons: [...new Set([...plan.reasons, ...dynamicReasonsFor(plan.finalStatus, plan.finalHealth, plan.enteredIndex >= 0, plan.highestTargetHit)])],
    rejectionReasons: [...new Set([
      ...plan.rejectionReasons,
      ...dynamicRejectionsFor(plan.finalStatus, plan.terminalRejection),
    ])],
    limitations: [...plan.limitations],
    semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION",
  }));
  return { analysisId, offset, limit, total, items };
}

export interface TradePlanCreationInput {
  candles: readonly CompactCandle[];
  completeness: TimeframeDataset["completeness"];
  signalIndex: number;
  family: OpportunityFamily;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  candidateScore: number;
  feature: PriceBehaviour;
  settings?: Partial<TradeManagementSettings>;
  higherTimeframeDatasets?: Partial<Record<"M5" | "M15" | "H1" | "D1", TimeframeDataset>>;
}

/** Deterministic plan-construction helper for replay, fixtures and family-rule tests. */
export function simulateTradePlanCreation(input: TradePlanCreationInput): TradePlanSnapshot {
  const familyIndex = SIGNAL_OPPORTUNITY_FAMILIES.indexOf(input.family);
  if (familyIndex < 0) throw new Error(`Unsupported opportunity family: ${input.family}`);
  if (input.signalIndex < 0 || input.signalIndex >= input.candles.length) {
    throw new Error("signalIndex is outside the supplied candle range.");
  }
  const prefixRange = new Float64Array(input.candles.length + 1);
  for (let index = 0; index < input.candles.length; index += 1) {
    prefixRange[index + 1] = prefixRange[index] + input.candles[index][2] - input.candles[index][3];
  }
  const priorAverageRange20 = averagePriorRange(prefixRange, input.signalIndex, 20);
  const averageRange20 = Math.max(
    priorAverageRange20 > 0
      ? priorAverageRange20
      : input.candles[input.signalIndex][2] - input.candles[input.signalIndex][3],
    0.01,
  );
  const emptyDataset: TimeframeDataset = { candles: [], completeness: [] };
  const datasets: Record<Timeframe, TimeframeDataset> = {
    M1: { candles: [...input.candles], completeness: [...input.completeness] },
    M5: input.higherTimeframeDatasets?.M5 ?? emptyDataset,
    M15: input.higherTimeframeDatasets?.M15 ?? emptyDataset,
    H1: input.higherTimeframeDatasets?.H1 ?? emptyDataset,
    D1: input.higherTimeframeDatasets?.D1 ?? emptyDataset,
  };
  const plan = buildStaticPlan(
    datasets,
    input.signalIndex,
    familyIndex,
    input.direction,
    input.candidateScore,
    input.feature,
    averageRange20,
    0,
    resolveSettings(input.settings),
  );
  const status = plan.initialStatus;
  return {
    timestampMs: plan.signalTimestampMs,
    planId: plan.planId,
    family: plan.family,
    direction: plan.direction,
    action: plan.action,
    status,
    health: "NOT_ACTIVE",
    executionQualification: plan.executionQualification,
    signalTimestampMs: plan.signalTimestampMs,
    enteredAtMs: null,
    entryPrice: null,
    entryZone: plan.entryZone,
    structuralRisk: plan.structuralRisk,
    targetSpace: plan.targetSpace,
    expectedMovement: plan.expectedMovement,
    filledExecution: null,
    executionCosts: plan.executionCosts,
    currentProtectiveStopPrice: plan.structuralRisk.stopLossPrice,
    managementAction: status === "ENTRY_VALID" ? "ENTER_IN_ZONE" : status === "WAIT_ENTRY" ? "WAIT" : "NO_ACTION",
    barsSinceSignal: 0,
    barsSinceEntry: 0,
    maximumFavourableExcursion: 0,
    maximumAdverseExcursion: 0,
    progressInRiskUnits: 0,
    reasons: [...plan.reasons],
    rejectionReasons: [...plan.rejectionReasons],
    limitations: [...plan.limitations],
    positionSizing: {
      status: "BROKER_CONTRACT_REQUIRED",
      message: "Lot size is not calculated because broker contract size, tick value, account equity and allowed risk were not supplied.",
    },
    semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION",
  };
}
