import { FixedMinHeap } from "./fixed-min-heap";
import { TIMEFRAME_MS } from "./constants";
import { getNextDailyBucketStart, type DailyBoundaryMode } from "./market-session";
import {
  analyzePriceBehaviourWindow,
  forEachPriceBehaviour,
} from "./price-behaviour";
import type {
  CandleCompleteness,
  CompactCandle,
  CompositeMarketState,
  DailyEnvironmentCondition,
  DailyEnvironmentState,
  ExecutionContext,
  ExecutionContextState,
  ExecutionQuality,
  HourlyLocationCondition,
  HourlyLocationState,
  HourlyLocationZone,
  IntradayNarrative,
  IntradayNarrativeState,
  LateEntryRisk,
  MarketMaturity,
  MarketStateAvailability,
  MultiTimeframeStateEvent,
  MultiTimeframeStateSnapshot,
  MultiTimeframeStateSummary,
  PriceBehaviour,
  PriceDirection,
  RollingCampaignStage,
  RollingCampaignState,
  SetupConstructionContext,
  SetupConstructionState,
  Timeframe,
  TimeframeAlignment,
  TimeframeDataset,
} from "./types";

const EPSILON = 1e-12;
const M1_MS = 60_000;
const ROLLING_5H_MS = 300 * M1_MS;

export const MULTI_TIMEFRAME_STATE_CONFIG = Object.freeze({
  roleContextBars: 80,
  dailyRangeLookback: 20,
  hourlyRangeLookback: 20,
  campaignMinutes: 300,
  campaignMinimumCandles: 240,
  campaignReopenCandles: 60,
  strongestEventLimit: 24,
});

interface RangeMetrics {
  priorHigh: Float64Array;
  priorLow: Float64Array;
  priorAverageRange: Float64Array;
}

interface RolePoint<T> {
  sourceTimestampMs: number;
  closeTimestampMs: number;
  usable: boolean;
  state: T;
}

interface CampaignPrepared {
  candles: readonly CompactCandle[];
  prefixAbsoluteChange: Float64Array;
  prefixRange: Float64Array;
  start300: Int32Array;
  start60: Int32Array;
  start15: Int32Array;
  rollingHigh300: Float64Array;
  rollingLow300: Float64Array;
}

export interface MultiTimeframeStateIndex {
  datasets: Record<Timeframe, TimeframeDataset>;
  dailyBoundaryMode: DailyBoundaryMode;
  daily: RolePoint<DailyEnvironmentState>[];
  hourly: RolePoint<HourlyLocationState>[];
  m15: RolePoint<IntradayNarrative>[];
  m5: RolePoint<SetupConstructionContext>[];
  campaign: CampaignPrepared;
}

interface StateBuildOptions {
  dailyBoundaryMode: DailyBoundaryMode;
}

const indexCache = new WeakMap<object, MultiTimeframeStateIndex>();

const DIRECTIONS: readonly PriceDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];
const ALIGNMENTS: readonly TimeframeAlignment[] = [
  "FRESH_ALIGNMENT",
  "MATURE_ALIGNMENT",
  "PRODUCTIVE_DISAGREEMENT",
  "DESTRUCTIVE_DISAGREEMENT",
  "MIXED",
  "NEUTRAL",
  "INSUFFICIENT_DATA",
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stable(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function stableNullable(value: number | null): number | null {
  return value === null ? null : stable(value);
}

function directionSign(direction: PriceDirection): number {
  return direction === "BULLISH" ? 1 : direction === "BEARISH" ? -1 : 0;
}

function directionFromValue(value: number, threshold = EPSILON): PriceDirection {
  if (value > threshold) return "BULLISH";
  if (value < -threshold) return "BEARISH";
  return "NEUTRAL";
}

function isCoverageUsable(item: CandleCompleteness | undefined): boolean {
  return item?.status === "COMPLETE" || item?.status === "EXPECTED_MARKET_CLOSURE";
}

function closeTimestamp(
  timeframe: Exclude<Timeframe, "M1">,
  timestampMs: number,
  dailyBoundaryMode: DailyBoundaryMode,
): number {
  return timeframe === "D1"
    ? getNextDailyBucketStart(timestampMs, dailyBoundaryMode)
    : timestampMs + TIMEFRAME_MS[timeframe];
}

function createCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function buildPriorRangeMetrics(
  candles: readonly CompactCandle[],
  lookback: number,
): RangeMetrics {
  const length = candles.length;
  const priorHigh = new Float64Array(length);
  const priorLow = new Float64Array(length);
  const priorAverageRange = new Float64Array(length);
  priorHigh.fill(Number.NaN);
  priorLow.fill(Number.NaN);
  priorAverageRange.fill(Number.NaN);

  const highDeque = new Int32Array(length);
  const lowDeque = new Int32Array(length);
  let highHead = 0;
  let highTail = 0;
  let lowHead = 0;
  let lowTail = 0;
  const prefixRange = new Float64Array(length + 1);

  for (let index = 0; index < length; index += 1) {
    const oldest = index - lookback;
    while (highHead < highTail && highDeque[highHead] < oldest) highHead += 1;
    while (lowHead < lowTail && lowDeque[lowHead] < oldest) lowHead += 1;

    if (highHead < highTail) priorHigh[index] = candles[highDeque[highHead]][2];
    if (lowHead < lowTail) priorLow[index] = candles[lowDeque[lowHead]][3];

    const start = Math.max(0, index - lookback);
    const count = index - start;
    if (count > 0) {
      priorAverageRange[index] = (prefixRange[index] - prefixRange[start]) / count;
    }

    while (highHead < highTail && candles[highDeque[highTail - 1]][2] <= candles[index][2]) {
      highTail -= 1;
    }
    highDeque[highTail++] = index;
    while (lowHead < lowTail && candles[lowDeque[lowTail - 1]][3] >= candles[index][3]) {
      lowTail -= 1;
    }
    lowDeque[lowTail++] = index;
    prefixRange[index + 1] = prefixRange[index] + Math.max(0, candles[index][2] - candles[index][3]);
  }

  return { priorHigh, priorLow, priorAverageRange };
}

function rangePosition(
  close: number,
  high: number,
  low: number,
): number | null {
  const width = high - low;
  return width > EPSILON ? clamp(((close - low) / width) * 100, -100, 200) : null;
}

function availabilityFor(index: number, usable: boolean, minimumBars: number): MarketStateAvailability {
  if (!usable) return "PARTIAL";
  return index + 1 >= minimumBars ? "AVAILABLE" : "INSUFFICIENT_DATA";
}

function dailyDirection(feature: PriceBehaviour): PriceDirection {
  if (Math.abs(feature.netProgress20) <= EPSILON || feature.efficiency20 < 0.18) return "NEUTRAL";
  return directionFromValue(feature.netProgress20);
}

function classifyDaily(
  candle: CompactCandle,
  feature: PriceBehaviour,
  index: number,
  usable: boolean,
  ranges: RangeMetrics,
): DailyEnvironmentState {
  const availability = availabilityFor(index, usable, 6);
  if (availability !== "AVAILABLE") {
    return {
      sourceTimestampMs: candle[0],
      availability,
      condition: "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      strength: 0,
      rangePositionPercent: null,
      volatilityRatio: feature.rangeRegimeRatio,
      maturity: "UNAVAILABLE",
    };
  }

  const direction = dailyDirection(feature);
  let condition: DailyEnvironmentCondition;
  if (feature.phase === "COMPRESSION") condition = "COMPRESSION";
  else if (feature.phase === "NOISY" && feature.efficiency20 < 0.25) condition = "NOISY";
  else if (
    direction === "BULLISH" &&
    (feature.phase === "EXPANSION" || feature.phase === "BULLISH_IMPULSE" || feature.breakState === "BULLISH_ACCEPTED")
  ) condition = "BULLISH_EXPANSION";
  else if (
    direction === "BEARISH" &&
    (feature.phase === "EXPANSION" || feature.phase === "BEARISH_IMPULSE" || feature.breakState === "BEARISH_ACCEPTED")
  ) condition = "BEARISH_EXPANSION";
  else if (direction === "BULLISH" && feature.efficiency20 >= 0.34) condition = "BULLISH_TREND";
  else if (direction === "BEARISH" && feature.efficiency20 >= 0.34) condition = "BEARISH_TREND";
  else if (feature.noiseScore >= 62 || feature.efficiency20 < 0.2) condition = "RANGE";
  else condition = "TRANSITION";

  const priorHigh = ranges.priorHigh[index];
  const priorLow = ranges.priorLow[index];
  const position = Number.isFinite(priorHigh) && Number.isFinite(priorLow)
    ? rangePosition(candle[4], priorHigh, priorLow)
    : null;
  const directionalStrength = feature.efficiency20 * 48;
  const impulseStrength = feature.impulseStrength * 0.28;
  const noisePenalty = feature.noiseScore * 0.18;
  const strength = clamp(directionalStrength + impulseStrength + 28 - noisePenalty, 0, 100);

  let maturity: MarketMaturity;
  if (feature.lateEntryRisk === "HIGH" || (feature.extensionVsAverageRange20 ?? 0) >= 4) maturity = "EXTENDED";
  else if (feature.impulseBars >= 12 || feature.lateEntryRisk === "MEDIUM") maturity = "MATURE";
  else if (feature.impulseDirection !== "NEUTRAL" && (feature.freshnessScore >= 70 || feature.impulseBars <= 4)) maturity = "FRESH";
  else maturity = "DEVELOPING";

  return {
    sourceTimestampMs: candle[0],
    availability,
    condition,
    direction,
    strength: stable(strength),
    rangePositionPercent: stableNullable(position),
    volatilityRatio: stableNullable(feature.rangeRegimeRatio),
    maturity,
  };
}

function hourlyZone(position: number | null): HourlyLocationZone {
  if (position === null) return "UNAVAILABLE";
  if (position > 105) return "ABOVE_RANGE";
  if (position >= 90) return "RANGE_HIGH";
  if (position >= 62.5) return "UPPER_QUARTILE";
  if (position > 37.5) return "MID_RANGE";
  if (position > 10) return "LOWER_QUARTILE";
  if (position >= -5) return "RANGE_LOW";
  return "BELOW_RANGE";
}

function classifyHourly(
  candle: CompactCandle,
  feature: PriceBehaviour,
  index: number,
  usable: boolean,
  ranges: RangeMetrics,
): HourlyLocationState {
  const availability = availabilityFor(index, usable, 10);
  if (availability !== "AVAILABLE") {
    return {
      sourceTimestampMs: candle[0],
      availability,
      zone: "UNAVAILABLE",
      condition: "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      rangePositionPercent: null,
      distanceToUpperInAverageRanges: null,
      distanceToLowerInAverageRanges: null,
      locationQuality: 0,
    };
  }

  const priorHigh = ranges.priorHigh[index];
  const priorLow = ranges.priorLow[index];
  const averageRange = ranges.priorAverageRange[index];
  const position = Number.isFinite(priorHigh) && Number.isFinite(priorLow)
    ? rangePosition(candle[4], priorHigh, priorLow)
    : null;
  const zone = hourlyZone(position);
  const direction = feature.efficiency20 >= 0.2
    ? directionFromValue(feature.netProgress20)
    : feature.impulseDirection;

  let condition: HourlyLocationCondition;
  if (zone === "ABOVE_RANGE") condition = "BREAKOUT_LOCATION";
  else if (zone === "BELOW_RANGE") condition = "BREAKDOWN_LOCATION";
  else if (feature.phase.endsWith("PULLBACK") && feature.impulseDirection !== "NEUTRAL") {
    condition = "WITH_TREND_PULLBACK";
  } else if (
    feature.lateEntryRisk === "HIGH" ||
    (direction === "BULLISH" && zone === "RANGE_HIGH") ||
    (direction === "BEARISH" && zone === "RANGE_LOW")
  ) {
    condition = "WITH_TREND_EXTENDED";
  } else if (
    feature.momentumCondition.startsWith("DECAYING") ||
    (feature.impulseDirection !== "NEUTRAL" && direction !== feature.impulseDirection)
  ) condition = "COUNTERTREND_CORRECTION";
  else if (feature.noiseScore >= 60 || direction === "NEUTRAL") condition = "RANGE_LOCATION";
  else condition = "TRANSITION_LOCATION";

  const upperDistance = Number.isFinite(priorHigh) && Number.isFinite(averageRange) && averageRange > EPSILON
    ? (priorHigh - candle[4]) / averageRange
    : null;
  const lowerDistance = Number.isFinite(priorLow) && Number.isFinite(averageRange) && averageRange > EPSILON
    ? (candle[4] - priorLow) / averageRange
    : null;
  const centrality = position === null ? 0 : 1 - Math.min(1, Math.abs(position - 50) / 50);
  const pullbackBonus = condition === "WITH_TREND_PULLBACK" ? 25 : 0;
  const extensionPenalty = condition === "WITH_TREND_EXTENDED" ? 35 : 0;
  const quality = clamp(45 + centrality * 20 + feature.freshnessScore * 0.25 + pullbackBonus - extensionPenalty, 0, 100);

  return {
    sourceTimestampMs: candle[0],
    availability,
    zone,
    condition,
    direction,
    rangePositionPercent: stableNullable(position),
    distanceToUpperInAverageRanges: stableNullable(upperDistance),
    distanceToLowerInAverageRanges: stableNullable(lowerDistance),
    locationQuality: stable(quality),
  };
}

function narrativeDirection(feature: PriceBehaviour): PriceDirection {
  if (feature.impulseDirection !== "NEUTRAL") return feature.impulseDirection;
  if (feature.efficiency10 >= 0.28) return directionFromValue(feature.netProgress10);
  return "NEUTRAL";
}

function classifyNarrative(
  candle: CompactCandle,
  feature: PriceBehaviour,
  index: number,
  usable: boolean,
): IntradayNarrative {
  const availability = availabilityFor(index, usable, 8);
  if (availability !== "AVAILABLE") {
    return {
      sourceTimestampMs: candle[0],
      availability,
      state: "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      strength: 0,
      pressureScore: 0,
    };
  }
  const direction = narrativeDirection(feature);
  let state: IntradayNarrativeState;
  if (feature.breakState.endsWith("FAILED") || feature.breakState === "BOTH_SIDES_FAILED") state = "FAILED_BREAK";
  else if (feature.breakState === "BULLISH_ACCEPTED") state = "BULLISH_ACCEPTANCE";
  else if (feature.breakState === "BEARISH_ACCEPTED") state = "BEARISH_ACCEPTANCE";
  else if (feature.phase === "COMPRESSION") state = "COMPRESSION";
  else if (feature.phase === "EXPANSION") state = "EXPANSION";
  else if (feature.phase === "NOISY") state = "NOISY";
  else if (feature.phase === "BULLISH_PULLBACK") state = "BEARISH_CORRECTION";
  else if (feature.phase === "BEARISH_PULLBACK") state = "BULLISH_CORRECTION";
  else if (feature.phase.endsWith("RECOVERY")) state = "ROTATION";
  else if (direction === "BULLISH" && (feature.efficiency5 >= 0.5 || feature.momentumCondition === "STEADY_BULLISH" || feature.momentumCondition === "ACCELERATING_BULLISH")) state = "BULLISH_PRESSURE";
  else if (direction === "BEARISH" && (feature.efficiency5 >= 0.5 || feature.momentumCondition === "STEADY_BEARISH" || feature.momentumCondition === "ACCELERATING_BEARISH")) state = "BEARISH_PRESSURE";
  else state = "BALANCED";

  const pressureScore = clamp(
    feature.efficiency5 * 38 +
      feature.efficiency20 * 18 +
      feature.impulseStrength * 0.24 +
      (100 - feature.noiseScore) * 0.2,
    0,
    100,
  );
  const strength = clamp(Math.max(pressureScore, feature.impulseStrength, feature.freshnessScore * 0.8), 0, 100);
  return {
    sourceTimestampMs: candle[0],
    availability,
    state,
    direction,
    strength: stable(strength),
    pressureScore: stable(pressureScore),
  };
}

function classifySetup(
  candle: CompactCandle,
  feature: PriceBehaviour,
  index: number,
  usable: boolean,
): SetupConstructionContext {
  const availability = availabilityFor(index, usable, 10);
  if (availability !== "AVAILABLE") {
    return {
      sourceTimestampMs: candle[0],
      availability,
      state: "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      constructionScore: 0,
      freshnessScore: feature.freshnessScore,
      lateEntryRisk: feature.lateEntryRisk,
    };
  }

  let state: SetupConstructionState;
  let direction: PriceDirection = feature.impulseDirection;
  if (feature.lateEntryRisk === "HIGH") state = "EXTENDED";
  else if (feature.breakState === "BULLISH_ACCEPTED") { state = "BULLISH_ACCEPTANCE"; direction = "BULLISH"; }
  else if (feature.breakState === "BEARISH_ACCEPTED") { state = "BEARISH_ACCEPTANCE"; direction = "BEARISH"; }
  else if (feature.breakState === "BULLISH_ATTEMPT") { state = "BULLISH_BREAK_ATTEMPT"; direction = "BULLISH"; }
  else if (feature.breakState === "BEARISH_ATTEMPT") { state = "BEARISH_BREAK_ATTEMPT"; direction = "BEARISH"; }
  else if (feature.breakState.endsWith("FAILED") || feature.breakState === "BOTH_SIDES_FAILED") state = "FAILED_BREAK";
  else if (feature.phase === "COMPRESSION") state = "COMPRESSION_BUILDING";
  else if (feature.phase === "NOISY") state = "NOISY";
  else if (feature.phase === "BULLISH_PULLBACK") { state = "BULLISH_PULLBACK"; direction = "BULLISH"; }
  else if (feature.phase === "BEARISH_PULLBACK") { state = "BEARISH_PULLBACK"; direction = "BEARISH"; }
  else if (feature.phase === "BULLISH_RECOVERY") { state = "BULLISH_RECOVERY"; direction = "BULLISH"; }
  else if (feature.phase === "BEARISH_RECOVERY") { state = "BEARISH_RECOVERY"; direction = "BEARISH"; }
  else if (feature.momentumCondition === "STEADY_BULLISH" || feature.momentumCondition === "ACCELERATING_BULLISH" || feature.netProgress5 > 0) { state = "BULLISH_PRESSURE"; direction = "BULLISH"; }
  else if (feature.momentumCondition === "STEADY_BEARISH" || feature.momentumCondition === "ACCELERATING_BEARISH" || feature.netProgress5 < 0) { state = "BEARISH_PRESSURE"; direction = "BEARISH"; }
  else { state = "IDLE"; direction = "NEUTRAL"; }

  const breakBonus = feature.breakState.endsWith("ACCEPTED") ? 22 : feature.breakState.endsWith("ATTEMPT") ? 10 : 0;
  const recoveryBonus = feature.phase.endsWith("RECOVERY") ? 15 : 0;
  const latePenalty = feature.lateEntryRisk === "HIGH" ? 35 : feature.lateEntryRisk === "MEDIUM" ? 12 : 0;
  const constructionScore = clamp(
    feature.efficiency5 * 30 +
      feature.impulseStrength * 0.22 +
      feature.freshnessScore * 0.28 +
      breakBonus + recoveryBonus - latePenalty,
    0,
    100,
  );

  return {
    sourceTimestampMs: candle[0],
    availability,
    state,
    direction,
    constructionScore: stable(constructionScore),
    freshnessScore: feature.freshnessScore,
    lateEntryRisk: feature.lateEntryRisk,
  };
}

function executionDirection(feature: PriceBehaviour): PriceDirection {
  if (feature.breakState.startsWith("BULLISH")) return feature.breakState === "BULLISH_FAILED" ? "BEARISH" : "BULLISH";
  if (feature.breakState.startsWith("BEARISH")) return feature.breakState === "BEARISH_FAILED" ? "BULLISH" : "BEARISH";
  if (feature.impulseDirection !== "NEUTRAL") return feature.impulseDirection;
  return directionFromValue(feature.netProgress3);
}

function classifyExecution(candle: CompactCandle, feature: PriceBehaviour): ExecutionContext {
  const direction = executionDirection(feature);
  let state: ExecutionContextState;
  if (feature.lateEntryRisk === "HIGH") state = "EXTENDED";
  else if (feature.breakState === "BULLISH_ACCEPTED") state = "BULLISH_BREAK_ACCEPTED";
  else if (feature.breakState === "BEARISH_ACCEPTED") state = "BEARISH_BREAK_ACCEPTED";
  else if (feature.breakState === "BULLISH_ATTEMPT") state = "BULLISH_BREAK_ATTEMPT";
  else if (feature.breakState === "BEARISH_ATTEMPT") state = "BEARISH_BREAK_ATTEMPT";
  else if (feature.breakState.endsWith("FAILED") || feature.breakState === "BOTH_SIDES_FAILED") state = "FAILED_BREAK";
  else if (feature.phase === "NOISY" || feature.noiseScore >= 72) state = "NOISY";
  else if (feature.phase === "BULLISH_PULLBACK") state = "BULLISH_PULLBACK";
  else if (feature.phase === "BEARISH_PULLBACK") state = "BEARISH_PULLBACK";
  else if (feature.phase === "BULLISH_RECOVERY") state = "BULLISH_RECOVERY";
  else if (feature.phase === "BEARISH_RECOVERY") state = "BEARISH_RECOVERY";
  else if (direction === "BULLISH" && feature.momentumCondition === "ACCELERATING_BULLISH" && feature.impulseBars <= 5) state = "BULLISH_IGNITION";
  else if (direction === "BEARISH" && feature.momentumCondition === "ACCELERATING_BEARISH" && feature.impulseBars <= 5) state = "BEARISH_IGNITION";
  else if (direction === "BULLISH" && feature.efficiency3 >= 0.55) state = "BULLISH_CONTINUATION";
  else if (direction === "BEARISH" && feature.efficiency3 >= 0.55) state = "BEARISH_CONTINUATION";
  else state = "CALM";

  let quality: ExecutionQuality;
  if (state === "NOISY") quality = "NOISY";
  else if (state === "EXTENDED" || feature.lateEntryRisk === "HIGH") quality = "LATE";
  else if (feature.noiseScore <= 42 && feature.lateEntryRisk === "LOW" && feature.efficiency3 >= 0.5) quality = "CLEAN";
  else quality = "MIXED";

  const intensity = clamp(
    feature.efficiency3 * 32 +
      feature.impulseStrength * 0.25 +
      feature.freshnessScore * 0.25 +
      (100 - feature.noiseScore) * 0.18,
    0,
    100,
  );
  return {
    sourceTimestampMs: candle[0],
    state,
    direction,
    quality,
    intensity: stable(intensity),
    freshnessScore: feature.freshnessScore,
    lateEntryRisk: feature.lateEntryRisk,
  };
}

function buildRoleSeries<T>(
  timeframe: "D1" | "H1" | "M15" | "M5",
  dataset: TimeframeDataset,
  dailyBoundaryMode: DailyBoundaryMode,
  classifier: (candle: CompactCandle, feature: PriceBehaviour, index: number, usable: boolean) => T,
): RolePoint<T>[] {
  const points = new Array<RolePoint<T>>(dataset.candles.length);
  forEachPriceBehaviour(dataset.candles, (feature, index) => {
    const candle = dataset.candles[index];
    const usable = isCoverageUsable(dataset.completeness[index]);
    points[index] = {
      sourceTimestampMs: candle[0],
      closeTimestampMs: closeTimestamp(timeframe, candle[0], dailyBoundaryMode),
      usable,
      state: classifier(candle, feature, index, usable),
    };
  });
  return points;
}

function buildDailySeries(
  dataset: TimeframeDataset,
  dailyBoundaryMode: DailyBoundaryMode,
): RolePoint<DailyEnvironmentState>[] {
  const ranges = buildPriorRangeMetrics(dataset.candles, MULTI_TIMEFRAME_STATE_CONFIG.dailyRangeLookback);
  return buildRoleSeries("D1", dataset, dailyBoundaryMode, (candle, feature, index, usable) =>
    classifyDaily(candle, feature, index, usable, ranges));
}

function buildHourlySeries(
  dataset: TimeframeDataset,
  dailyBoundaryMode: DailyBoundaryMode,
): RolePoint<HourlyLocationState>[] {
  const ranges = buildPriorRangeMetrics(dataset.candles, MULTI_TIMEFRAME_STATE_CONFIG.hourlyRangeLookback);
  return buildRoleSeries("H1", dataset, dailyBoundaryMode, (candle, feature, index, usable) =>
    classifyHourly(candle, feature, index, usable, ranges));
}

function buildM15Series(
  dataset: TimeframeDataset,
  dailyBoundaryMode: DailyBoundaryMode,
): RolePoint<IntradayNarrative>[] {
  return buildRoleSeries("M15", dataset, dailyBoundaryMode, classifyNarrative);
}

function buildM5Series(
  dataset: TimeframeDataset,
  dailyBoundaryMode: DailyBoundaryMode,
): RolePoint<SetupConstructionContext>[] {
  return buildRoleSeries("M5", dataset, dailyBoundaryMode, classifySetup);
}

function buildTimeWindowStarts(candles: readonly CompactCandle[], durationMs: number): Int32Array {
  const result = new Int32Array(candles.length);
  let start = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const anchorClose = candles[index][0] + M1_MS;
    const minimum = anchorClose - durationMs;
    while (start < index && candles[start][0] < minimum) start += 1;
    result[index] = start;
  }
  return result;
}

function buildRollingExtreme(
  candles: readonly CompactCandle[],
  starts: Int32Array,
  field: 2 | 3,
  mode: "MAX" | "MIN",
): Float64Array {
  const result = new Float64Array(candles.length);
  const deque = new Int32Array(candles.length);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const start = starts[index];
    while (head < tail && deque[head] < start) head += 1;
    if (mode === "MAX") {
      while (head < tail && candles[deque[tail - 1]][field] <= candles[index][field]) tail -= 1;
    } else {
      while (head < tail && candles[deque[tail - 1]][field] >= candles[index][field]) tail -= 1;
    }
    deque[tail++] = index;
    result[index] = candles[deque[head]][field];
  }
  return result;
}

function prepareCampaign(candles: readonly CompactCandle[]): CampaignPrepared {
  const length = candles.length;
  const prefixAbsoluteChange = new Float64Array(length + 1);
  const prefixRange = new Float64Array(length + 1);
  for (let index = 0; index < length; index += 1) {
    const previousClose = index > 0 ? candles[index - 1][4] : candles[index][1];
    prefixAbsoluteChange[index + 1] = prefixAbsoluteChange[index] + Math.abs(candles[index][4] - previousClose);
    prefixRange[index + 1] = prefixRange[index] + Math.max(0, candles[index][2] - candles[index][3]);
  }
  const start300 = buildTimeWindowStarts(candles, ROLLING_5H_MS);
  const start60 = buildTimeWindowStarts(candles, 60 * M1_MS);
  const start15 = buildTimeWindowStarts(candles, 15 * M1_MS);
  return {
    candles,
    prefixAbsoluteChange,
    prefixRange,
    start300,
    start60,
    start15,
    rollingHigh300: buildRollingExtreme(candles, start300, 2, "MAX"),
    rollingLow300: buildRollingExtreme(candles, start300, 3, "MIN"),
  };
}

function sum(prefix: Float64Array, from: number, to: number): number {
  return prefix[to] - prefix[from];
}

function progressBetween(prepared: CampaignPrepared, from: number, to: number): {
  net: number;
  gross: number;
  efficiency: number;
  speed: number;
  direction: PriceDirection;
} {
  if (to <= from) return { net: 0, gross: 0, efficiency: 0, speed: 0, direction: "NEUTRAL" };
  const net = prepared.candles[to][4] - prepared.candles[from][4];
  const gross = sum(prepared.prefixAbsoluteChange, from + 1, to + 1);
  return {
    net,
    gross,
    efficiency: gross > EPSILON ? Math.abs(net) / gross : 0,
    speed: Math.abs(net) / Math.max(1, to - from),
    direction: directionFromValue(net),
  };
}

function campaignAt(prepared: CampaignPrepared, index: number): RollingCampaignState {
  const candles = prepared.candles;
  const anchorClose = candles[index][0] + M1_MS;
  const start = prepared.start300[index];
  const present = index - start + 1;
  const availability: MarketStateAvailability = present >= MULTI_TIMEFRAME_STATE_CONFIG.campaignMinimumCandles
    ? "AVAILABLE"
    : present >= MULTI_TIMEFRAME_STATE_CONFIG.campaignReopenCandles
      ? "PARTIAL"
      : "INSUFFICIENT_DATA";
  if (availability === "INSUFFICIENT_DATA") {
    return {
      fromTimestampMs: candles[start]?.[0] ?? null,
      toTimestampMs: anchorClose,
      availability,
      stage: present > 0 ? "SESSION_REOPEN" : "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      strength: 0,
      efficiency: 0,
      rangePositionPercent: null,
      recentProgressRatio: null,
      candlesPresent: present,
    };
  }

  const long = progressBetween(prepared, start, index);
  const recentStart = prepared.start60[index];
  const shortStart = prepared.start15[index];
  const recent = progressBetween(prepared, recentStart, index);
  const short = progressBetween(prepared, shortStart, index);
  const averageRange = sum(prepared.prefixRange, start, index + 1) / Math.max(1, present);
  const normalizedMove = averageRange > EPSILON ? Math.abs(long.net) / averageRange : 0;
  const direction = normalizedMove >= 3 && long.efficiency >= 0.14 ? long.direction : "NEUTRAL";
  const high = prepared.rollingHigh300[index];
  const low = prepared.rollingLow300[index];
  const position = rangePosition(candles[index][4], high, low);
  const recentRatio = Math.abs(long.net) > EPSILON ? recent.net / Math.abs(long.net) : null;
  const recentAverageRange = sum(prepared.prefixRange, recentStart, index + 1) / Math.max(1, index - recentStart + 1);
  const priorEnd = recentStart;
  const priorStart = Math.max(start, priorEnd - (index - recentStart + 1));
  const priorAverageRange = priorEnd > priorStart
    ? sum(prepared.prefixRange, priorStart, priorEnd) / (priorEnd - priorStart)
    : averageRange;
  const volatilityRatio = priorAverageRange > EPSILON ? recentAverageRange / priorAverageRange : 1;

  let stage: RollingCampaignStage;
  if (availability === "PARTIAL") stage = "SESSION_REOPEN";
  else if (volatilityRatio <= 0.68 && recent.efficiency < 0.35) stage = "COMPRESSION";
  else if (direction === "NEUTRAL") stage = "BALANCE";
  else if (recent.direction !== "NEUTRAL" && recent.direction !== direction) {
    stage = short.direction === direction
      ? direction === "BULLISH" ? "BULLISH_RECOVERY" : "BEARISH_RECOVERY"
      : direction === "BULLISH" ? "BULLISH_PULLBACK" : "BEARISH_PULLBACK";
  } else if (recent.direction === direction && recent.efficiency < 0.25) {
    stage = direction === "BULLISH" ? "BULLISH_DECAY" : "BEARISH_DECAY";
  } else {
    stage = direction === "BULLISH" ? "BULLISH_IMPULSE" : "BEARISH_IMPULSE";
  }

  const strength = direction === "NEUTRAL"
    ? clamp((1 - long.efficiency) * 25, 0, 35)
    : clamp(long.efficiency * 48 + Math.min(normalizedMove / 8, 1) * 32 + recent.efficiency * 20, 0, 100);
  return {
    fromTimestampMs: candles[start][0],
    toTimestampMs: anchorClose,
    availability,
    stage,
    direction,
    strength: stable(strength),
    efficiency: stable(long.efficiency),
    rangePositionPercent: stableNullable(position),
    recentProgressRatio: stableNullable(recentRatio),
    candlesPresent: present,
  };
}

function latestClosedRole<T>(points: readonly RolePoint<T>[], anchorTimestampMs: number): T | null {
  let low = 0;
  let high = points.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (points[middle].closeTimestampMs <= anchorTimestampMs) {
      match = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return match >= 0 ? points[match].state : null;
}

function missingDaily(): DailyEnvironmentState {
  return { sourceTimestampMs: null, availability: "INSUFFICIENT_DATA", condition: "INSUFFICIENT_DATA", direction: "NEUTRAL", strength: 0, rangePositionPercent: null, volatilityRatio: null, maturity: "UNAVAILABLE" };
}
function missingHourly(): HourlyLocationState {
  return { sourceTimestampMs: null, availability: "INSUFFICIENT_DATA", zone: "UNAVAILABLE", condition: "INSUFFICIENT_DATA", direction: "NEUTRAL", rangePositionPercent: null, distanceToUpperInAverageRanges: null, distanceToLowerInAverageRanges: null, locationQuality: 0 };
}
function missingNarrative(): IntradayNarrative {
  return { sourceTimestampMs: null, availability: "INSUFFICIENT_DATA", state: "INSUFFICIENT_DATA", direction: "NEUTRAL", strength: 0, pressureScore: 0 };
}
function missingSetup(): SetupConstructionContext {
  return { sourceTimestampMs: null, availability: "INSUFFICIENT_DATA", state: "INSUFFICIENT_DATA", direction: "NEUTRAL", constructionScore: 0, freshnessScore: 0, lateEntryRisk: "LOW" };
}

function isOpposite(first: PriceDirection, second: PriceDirection): boolean {
  return first !== "NEUTRAL" && second !== "NEUTRAL" && first !== second;
}

function buildComposite(
  daily: DailyEnvironmentState,
  rolling: RollingCampaignState,
  hourly: HourlyLocationState,
  m15: IntradayNarrative,
  m5: SetupConstructionContext,
  m1: ExecutionContext,
): MultiTimeframeStateSnapshot["composite"] {
  const layers = [
    { direction: daily.direction, strength: daily.strength, available: daily.availability === "AVAILABLE", weight: 25 },
    { direction: rolling.direction, strength: rolling.strength, available: rolling.availability === "AVAILABLE", weight: 25 },
    { direction: hourly.direction, strength: hourly.locationQuality, available: hourly.availability === "AVAILABLE", weight: 20 },
    { direction: m15.direction, strength: m15.strength, available: m15.availability === "AVAILABLE", weight: 15 },
    { direction: m5.direction, strength: m5.constructionScore, available: m5.availability === "AVAILABLE", weight: 10 },
    { direction: m1.direction, strength: m1.intensity, available: true, weight: 5 },
  ];
  let signedWeight = 0;
  let availableWeight = 0;
  let strengthTotal = 0;
  let availableLayers = 0;
  for (const layer of layers) {
    if (!layer.available) continue;
    availableLayers += 1;
    availableWeight += layer.weight;
    signedWeight += directionSign(layer.direction) * layer.weight;
    strengthTotal += layer.strength * layer.weight;
  }
  const direction = availableWeight > 0 && Math.abs(signedWeight) / availableWeight >= 0.18
    ? directionFromValue(signedWeight)
    : "NEUTRAL";
  let agreementCount = 0;
  let conflictCount = 0;
  for (const layer of layers) {
    if (!layer.available || layer.direction === "NEUTRAL" || direction === "NEUTRAL") continue;
    if (layer.direction === direction) agreementCount += 1;
    else conflictCount += 1;
  }
  const directionalCoherence = availableWeight > 0 ? Math.abs(signedWeight) / availableWeight : 0;
  const averageStrength = availableWeight > 0 ? strengthTotal / availableWeight : 0;
  const evidenceScore = clamp(directionalCoherence * 65 + averageStrength * 0.35, 0, 100);

  let alignment: TimeframeAlignment;
  const higherAgree = daily.direction !== "NEUTRAL" && daily.direction === rolling.direction;
  const highConflict = isOpposite(daily.direction, rolling.direction) || isOpposite(rolling.direction, hourly.direction);
  const lowerAligned = [m15.direction, m5.direction, m1.direction].filter((item) => item === direction).length;
  if (availableLayers < 4) alignment = "INSUFFICIENT_DATA";
  else if (direction === "NEUTRAL" && conflictCount === 0) alignment = "NEUTRAL";
  else if (highConflict && conflictCount >= 2) alignment = "DESTRUCTIVE_DISAGREEMENT";
  else if (
    higherAgree &&
    direction === daily.direction &&
    hourly.direction !== direction &&
    lowerAligned >= 2
  ) alignment = "PRODUCTIVE_DISAGREEMENT";
  else if (
    agreementCount >= 5 &&
    (daily.maturity === "EXTENDED" || daily.maturity === "MATURE" || m5.lateEntryRisk === "HIGH" || m1.lateEntryRisk === "HIGH")
  ) alignment = "MATURE_ALIGNMENT";
  else if (agreementCount >= 4 && lowerAligned >= 2 && !highConflict) alignment = "FRESH_ALIGNMENT";
  else alignment = "MIXED";

  let state: CompositeMarketState;
  if (alignment === "INSUFFICIENT_DATA") state = "INSUFFICIENT_DATA";
  else if (alignment === "DESTRUCTIVE_DISAGREEMENT" || m15.state === "NOISY" || m5.state === "NOISY" || m1.state === "NOISY") state = "NOISE";
  else if (rolling.stage === "COMPRESSION" || m15.state === "COMPRESSION" || m5.state === "COMPRESSION_BUILDING") state = "COMPRESSION";
  else if (
    daily.condition.endsWith("EXPANSION") &&
    rolling.stage.endsWith("IMPULSE") &&
    (m15.state.endsWith("ACCEPTANCE") || m15.state === "EXPANSION")
  ) state = "EXPANSION";
  else if (rolling.stage.endsWith("PULLBACK") || hourly.condition === "COUNTERTREND_CORRECTION") state = "CORRECTION";
  else if (alignment === "PRODUCTIVE_DISAGREEMENT" || m15.state === "ROTATION" || m5.state.endsWith("RECOVERY")) state = "ROTATION";
  else if (alignment === "FRESH_ALIGNMENT" || alignment === "MATURE_ALIGNMENT") state = "TREND_CONTINUATION";
  else if (daily.condition === "RANGE" || rolling.stage === "BALANCE" || alignment === "NEUTRAL") state = "RANGE";
  else state = "TRANSITION";

  return {
    direction,
    alignment,
    state,
    evidenceScore: stable(evidenceScore),
    agreementCount,
    conflictCount,
    availableLayers,
  };
}

function m1IndexAtOrBefore(candles: readonly CompactCandle[], anchorTimestampMs: number): number {
  let low = 0;
  let high = candles.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] + M1_MS <= anchorTimestampMs) {
      match = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return match;
}

export function createMultiTimeframeStateIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: StateBuildOptions,
): MultiTimeframeStateIndex {
  return {
    datasets,
    dailyBoundaryMode: options.dailyBoundaryMode,
    daily: buildDailySeries(datasets.D1, options.dailyBoundaryMode),
    hourly: buildHourlySeries(datasets.H1, options.dailyBoundaryMode),
    m15: buildM15Series(datasets.M15, options.dailyBoundaryMode),
    m5: buildM5Series(datasets.M5, options.dailyBoundaryMode),
    campaign: prepareCampaign(datasets.M1.candles),
  };
}

export function getOrCreateMultiTimeframeStateIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  options: StateBuildOptions,
): MultiTimeframeStateIndex {
  const cached = indexCache.get(datasets);
  if (cached && cached.dailyBoundaryMode === options.dailyBoundaryMode) return cached;
  const created = createMultiTimeframeStateIndex(datasets, options);
  indexCache.set(datasets, created);
  return created;
}

export function analyzeMultiTimeframeStateAt(
  index: MultiTimeframeStateIndex,
  anchorTimestampMs: number,
): MultiTimeframeStateSnapshot | null {
  const m1Candles = index.datasets.M1.candles;
  const m1Index = m1IndexAtOrBefore(m1Candles, anchorTimestampMs);
  if (m1Index < 0) return null;
  const m1Feature = analyzePriceBehaviourWindow(m1Candles, m1Index, 1)[0];
  if (!m1Feature) return null;
  const actualAnchor = m1Candles[m1Index][0] + M1_MS;
  const daily = latestClosedRole(index.daily, actualAnchor) ?? missingDaily();
  const hourly = latestClosedRole(index.hourly, actualAnchor) ?? missingHourly();
  const m15 = latestClosedRole(index.m15, actualAnchor) ?? missingNarrative();
  const m5 = latestClosedRole(index.m5, actualAnchor) ?? missingSetup();
  const rolling5h = campaignAt(index.campaign, m1Index);
  const m1 = classifyExecution(m1Candles[m1Index], m1Feature);
  return {
    timestampMs: actualAnchor,
    daily,
    rolling5h,
    hourly,
    m15,
    m5,
    m1,
    composite: buildComposite(daily, rolling5h, hourly, m15, m5, m1),
  };
}

export function forEachMultiTimeframeState(
  index: MultiTimeframeStateIndex,
  callback: (
    snapshot: MultiTimeframeStateSnapshot,
    m1Feature: PriceBehaviour,
    candleIndex: number,
  ) => void,
): void {
  const m1Candles = index.datasets.M1.candles;
  let dailyPointer = 0;
  let hourlyPointer = 0;
  let m15Pointer = 0;
  let m5Pointer = 0;
  let daily: DailyEnvironmentState | null = null;
  let hourly: HourlyLocationState | null = null;
  let m15: IntradayNarrative | null = null;
  let m5: SetupConstructionContext | null = null;

  forEachPriceBehaviour(m1Candles, (feature, candleIndex) => {
    const anchor = m1Candles[candleIndex][0] + M1_MS;
    while (dailyPointer < index.daily.length && index.daily[dailyPointer].closeTimestampMs <= anchor) {
      daily = index.daily[dailyPointer].state;
      dailyPointer += 1;
    }
    while (hourlyPointer < index.hourly.length && index.hourly[hourlyPointer].closeTimestampMs <= anchor) {
      hourly = index.hourly[hourlyPointer].state;
      hourlyPointer += 1;
    }
    while (m15Pointer < index.m15.length && index.m15[m15Pointer].closeTimestampMs <= anchor) {
      m15 = index.m15[m15Pointer].state;
      m15Pointer += 1;
    }
    while (m5Pointer < index.m5.length && index.m5[m5Pointer].closeTimestampMs <= anchor) {
      m5 = index.m5[m5Pointer].state;
      m5Pointer += 1;
    }

    const dailyState = daily ?? missingDaily();
    const hourlyState = hourly ?? missingHourly();
    const m15State = m15 ?? missingNarrative();
    const m5State = m5 ?? missingSetup();
    const rolling5h = campaignAt(index.campaign, candleIndex);
    const m1 = classifyExecution(m1Candles[candleIndex], feature);
    const snapshot: MultiTimeframeStateSnapshot = {
      timestampMs: anchor,
      daily: dailyState,
      rolling5h,
      hourly: hourlyState,
      m15: m15State,
      m5: m5State,
      m1,
      composite: buildComposite(dailyState, rolling5h, hourlyState, m15State, m5State, m1),
    };
    callback(snapshot, feature, candleIndex);
  });
}

export function summarizeMultiTimeframeStates(
  index: MultiTimeframeStateIndex,
  strongestLimit: number = MULTI_TIMEFRAME_STATE_CONFIG.strongestEventLimit,
  fromTimestampMs = Number.NEGATIVE_INFINITY,
  toTimestampMs = Number.POSITIVE_INFINITY,
): { summary: MultiTimeframeStateSummary; latest: MultiTimeframeStateSnapshot | null } {
  const directionCounts = createCountRecord(DIRECTIONS);
  const alignmentCounts = createCountRecord(ALIGNMENTS);
  const stateCounts = createCountRecord(COMPOSITE_STATES);
  const strongest = new FixedMinHeap<MultiTimeframeStateEvent>(strongestLimit, (item) => item.evidenceScore);
  let evidenceTotal = 0;
  let sampleCount = 0;
  let latest: MultiTimeframeStateSnapshot | null = null;

  forEachMultiTimeframeState(index, (snapshot) => {
    if (snapshot.timestampMs < fromTimestampMs || snapshot.timestampMs >= toTimestampMs) return;
    latest = snapshot;
    sampleCount += 1;
    evidenceTotal += snapshot.composite.evidenceScore;
    directionCounts[snapshot.composite.direction] += 1;
    alignmentCounts[snapshot.composite.alignment] += 1;
    stateCounts[snapshot.composite.state] += 1;
    if (snapshot.composite.evidenceScore >= 55) {
      strongest.push({
        timestampMs: snapshot.timestampMs,
        direction: snapshot.composite.direction,
        alignment: snapshot.composite.alignment,
        state: snapshot.composite.state,
        evidenceScore: snapshot.composite.evidenceScore,
      });
    }
  });

  return {
    summary: {
      sampleCount,
      directionCounts,
      alignmentCounts,
      stateCounts,
      averageEvidenceScore: sampleCount > 0 ? stable(evidenceTotal / sampleCount) : 0,
      strongestEvents: strongest.toDescendingArray(),
    },
    latest,
  };
}
