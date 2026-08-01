import { CANDLE_BEHAVIOUR_TAGS } from "./constants";
import { FixedMinHeap } from "./fixed-min-heap";
import { percentile } from "./quickselect";
import type {
  BehaviourEvent,
  BreakBehaviour,
  CandleBehaviour,
  CandleBehaviourSummary,
  CandleBehaviourTag,
  CandleDirection,
  CompactCandle,
  LookbackComparison,
} from "./types";

const LOOKBACKS = [1, 3, 5, 10, 20] as const;
const EPSILON = 1e-12;

interface PrefixStats {
  range: Float64Array;
  body: Float64Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > EPSILON ? numerator / denominator : null;
}

function createPrefixStats(candles: readonly CompactCandle[]): PrefixStats {
  const range = new Float64Array(candles.length + 1);
  const body = new Float64Array(candles.length + 1);
  for (let index = 0; index < candles.length; index += 1) {
    const candleRange = candles[index][2] - candles[index][3];
    const candleBody = Math.abs(candles[index][4] - candles[index][1]);
    range[index + 1] = range[index] + candleRange;
    body[index + 1] = body[index] + candleBody;
  }
  return { range, body };
}

function averageFromPrefix(
  prefix: Float64Array,
  fromInclusive: number,
  toExclusive: number,
): number {
  const count = toExclusive - fromInclusive;
  return count > 0 ? (prefix[toExclusive] - prefix[fromInclusive]) / count : 0;
}

function directionOf(open: number, close: number): CandleDirection {
  if (close > open + EPSILON) return "BULLISH";
  if (close < open - EPSILON) return "BEARISH";
  return "NEUTRAL";
}

function choosePrimaryTag(tags: readonly CandleBehaviourTag[]): CandleBehaviourTag {
  const priority: readonly CandleBehaviourTag[] = [
    "BULLISH_DISPLACEMENT",
    "BEARISH_DISPLACEMENT",
    "EXHAUSTION_CANDIDATE",
    "WICK_SWEEP_HIGH",
    "WICK_SWEEP_LOW",
    "UPPER_REJECTION",
    "LOWER_REJECTION",
    "OUTSIDE_BAR",
    "RANGE_EXPANSION",
    "RANGE_COMPRESSION",
    "INSIDE_BAR",
    "INDECISION",
    "NORMAL",
  ];
  return priority.find((tag) => tags.includes(tag)) ?? "NORMAL";
}

function buildFeature(
  candles: readonly CompactCandle[],
  index: number,
  prefix: PrefixStats,
): CandleBehaviour {
  const [timestampMs, open, high, low, close] = candles[index];
  const range = Math.max(0, high - low);
  const body = Math.abs(close - open);
  const upperWick = Math.max(0, high - Math.max(open, close));
  const lowerWick = Math.max(0, Math.min(open, close) - low);
  const direction = directionOf(open, close);
  const bodyToRange = safeRatio(body, range) ?? 0;
  const closeLocation = safeRatio(close - low, range) ?? 0.5;
  const upperWickRatio = safeRatio(upperWick, range) ?? 0;
  const lowerWickRatio = safeRatio(lowerWick, range) ?? 0;
  const previous20Start = Math.max(0, index - 20);
  const previous20Count = index - previous20Start;
  const averageRange20 = averageFromPrefix(prefix.range, previous20Start, index);
  const averageBody20 = averageFromPrefix(prefix.body, previous20Start, index);
  const rangeVsAverage20 = previous20Count > 0 ? safeRatio(range, averageRange20) : null;
  const bodyVsAverage20 = previous20Count > 0 ? safeRatio(body, averageBody20) : null;

  let overlapWithPrevious: number | null = null;
  let breakBehaviour: BreakBehaviour = "NONE";
  const tags: CandleBehaviourTag[] = [];

  if (index > 0) {
    const previous = candles[index - 1];
    const overlap = Math.max(0, Math.min(high, previous[2]) - Math.max(low, previous[3]));
    const denominator = Math.min(range, previous[2] - previous[3]);
    overlapWithPrevious = safeRatio(overlap, denominator);

    const breaksHigh = high > previous[2];
    const breaksLow = low < previous[3];
    if (breaksHigh && breaksLow) breakBehaviour = "OUTSIDE_BREAK";
    else if (breaksHigh) {
      breakBehaviour = close > previous[2] ? "BULLISH_BODY_BREAK" : "HIGH_WICK_BREAK";
    } else if (breaksLow) {
      breakBehaviour = close < previous[3] ? "BEARISH_BODY_BREAK" : "LOW_WICK_BREAK";
    }

    if (high <= previous[2] && low >= previous[3]) tags.push("INSIDE_BAR");
    if (breaksHigh && breaksLow) tags.push("OUTSIDE_BAR");
    if (breaksHigh && close <= previous[2]) tags.push("WICK_SWEEP_HIGH");
    if (breaksLow && close >= previous[3]) tags.push("WICK_SWEEP_LOW");
  }

  const ratio20 = rangeVsAverage20 ?? 1;
  if (previous20Count >= 5 && ratio20 >= 1.5) tags.push("RANGE_EXPANSION");
  if (previous20Count >= 5 && ratio20 <= 0.65) tags.push("RANGE_COMPRESSION");
  if (bodyToRange <= 0.25) tags.push("INDECISION");
  if (upperWickRatio >= 0.45 && closeLocation <= 0.6) tags.push("UPPER_REJECTION");
  if (lowerWickRatio >= 0.45 && closeLocation >= 0.4) tags.push("LOWER_REJECTION");

  if (
    direction === "BULLISH" &&
    previous20Count >= 5 &&
    ratio20 >= 1.5 &&
    bodyToRange >= 0.7 &&
    closeLocation >= 0.8 &&
    (breakBehaviour === "BULLISH_BODY_BREAK" || breakBehaviour === "OUTSIDE_BREAK")
  ) {
    tags.push("BULLISH_DISPLACEMENT");
  }

  if (
    direction === "BEARISH" &&
    previous20Count >= 5 &&
    ratio20 >= 1.5 &&
    bodyToRange >= 0.7 &&
    closeLocation <= 0.2 &&
    (breakBehaviour === "BEARISH_BODY_BREAK" || breakBehaviour === "OUTSIDE_BREAK")
  ) {
    tags.push("BEARISH_DISPLACEMENT");
  }

  if (
    previous20Count >= 5 &&
    ratio20 >= 2 &&
    ((direction === "BULLISH" && upperWickRatio >= 0.35 && closeLocation < 0.72) ||
      (direction === "BEARISH" && lowerWickRatio >= 0.35 && closeLocation > 0.28))
  ) {
    tags.push("EXHAUSTION_CANDIDATE");
  }

  const comparisons: LookbackComparison[] = [];
  let maximumHighBreakLookback: 0 | 1 | 3 | 5 | 10 | 20 = 0;
  let maximumLowBreakLookback: 0 | 1 | 3 | 5 | 10 | 20 = 0;

  for (const lookback of LOOKBACKS) {
    if (index < lookback) continue;
    let previousMaxHigh = -Infinity;
    let previousMinLow = Infinity;
    for (let cursor = index - lookback; cursor < index; cursor += 1) {
      if (candles[cursor][2] > previousMaxHigh) previousMaxHigh = candles[cursor][2];
      if (candles[cursor][3] < previousMinLow) previousMinLow = candles[cursor][3];
    }
    const highBreak = high > previousMaxHigh;
    const lowBreak = low < previousMinLow;
    if (highBreak) maximumHighBreakLookback = lookback;
    if (lowBreak) maximumLowBreakLookback = lookback;
    const averageRange = averageFromPrefix(prefix.range, index - lookback, index);
    comparisons.push({
      lookback,
      highBreak,
      lowBreak,
      closeChange: close - candles[index - lookback][4],
      rangeVsAverage: safeRatio(range, averageRange),
    });
  }

  if (tags.length === 0) tags.push("NORMAL");
  const primaryTag = choosePrimaryTag(tags);
  const directionalCloseQuality =
    direction === "BULLISH"
      ? closeLocation
      : direction === "BEARISH"
        ? 1 - closeLocation
        : 0.5;
  const lookbackStrength = Math.max(maximumHighBreakLookback, maximumLowBreakLookback) / 20;
  const expansionStrength = clamp((ratio20 - 1) / 2, 0, 1);
  const rejectionStrength = Math.max(upperWickRatio, lowerWickRatio);
  const compressionStrength = ratio20 < 1 ? clamp(1 - ratio20, 0, 1) : 0;

  let intensityScore =
    bodyToRange * 25 +
    directionalCloseQuality * 20 +
    expansionStrength * 30 +
    lookbackStrength * 15 +
    rejectionStrength * 10;
  if (primaryTag === "RANGE_COMPRESSION") {
    intensityScore = compressionStrength * 55 + (overlapWithPrevious ?? 0) * 25 + 20;
  }
  if (primaryTag === "INDECISION") {
    intensityScore = (1 - bodyToRange) * 60 + Math.max(upperWickRatio, lowerWickRatio) * 30;
  }

  return {
    timestampMs,
    direction,
    range,
    body,
    upperWick,
    lowerWick,
    bodyToRange,
    closeLocation,
    upperWickRatio,
    lowerWickRatio,
    rangeVsAverage20,
    bodyVsAverage20,
    overlapWithPrevious,
    breakBehaviour,
    maximumHighBreakLookback,
    maximumLowBreakLookback,
    primaryTag,
    tags,
    intensityScore: Math.round(clamp(intensityScore, 0, 100) * 100) / 100,
    comparisons,
  };
}

export function analyzeCandleBehaviourWindow(
  candles: readonly CompactCandle[],
  offset: number,
  limit: number,
): CandleBehaviour[] {
  const safeOffset = Math.max(0, Math.min(candles.length, Math.floor(offset)));
  const safeLimit = Math.max(0, Math.floor(limit));
  const end = Math.min(candles.length, safeOffset + safeLimit);
  const prefix = createPrefixStats(candles);
  const result = new Array<CandleBehaviour>(end - safeOffset);
  for (let index = safeOffset; index < end; index += 1) {
    result[index - safeOffset] = buildFeature(candles, index, prefix);
  }
  return result;
}

function emptyTagCounts(): Record<CandleBehaviourTag, number> {
  return Object.fromEntries(CANDLE_BEHAVIOUR_TAGS.map((tag) => [tag, 0])) as Record<
    CandleBehaviourTag,
    number
  >;
}

export function summarizeCandleBehaviour(
  candles: readonly CompactCandle[],
  strongestEventLimit = 20,
): CandleBehaviourSummary {
  const tagCounts = emptyTagCounts();
  if (candles.length === 0) {
    return {
      candleCount: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      averageRange: 0,
      medianRange: 0,
      p90Range: 0,
      p95Range: 0,
      averageBodyToRange: 0,
      tagCounts,
      strongestEvents: [],
    };
  }

  const prefix = createPrefixStats(candles);
  const ranges = new Array<number>(candles.length);
  const strongest = new FixedMinHeap<BehaviourEvent>(
    strongestEventLimit,
    (event) => event.intensityScore,
  );

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let totalRange = 0;
  let totalBodyToRange = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const feature = buildFeature(candles, index, prefix);
    ranges[index] = feature.range;
    totalRange += feature.range;
    totalBodyToRange += feature.bodyToRange;
    if (feature.direction === "BULLISH") bullishCount += 1;
    else if (feature.direction === "BEARISH") bearishCount += 1;
    else neutralCount += 1;
    for (const tag of feature.tags) tagCounts[tag] += 1;
    strongest.push({
      timestampMs: feature.timestampMs,
      primaryTag: feature.primaryTag,
      direction: feature.direction,
      intensityScore: feature.intensityScore,
      rangeVsAverage20: feature.rangeVsAverage20,
    });
  }

  return {
    candleCount: candles.length,
    bullishCount,
    bearishCount,
    neutralCount,
    averageRange: totalRange / candles.length,
    medianRange: percentile(ranges, 0.5),
    p90Range: percentile(ranges, 0.9),
    p95Range: percentile(ranges, 0.95),
    averageBodyToRange: totalBodyToRange / candles.length,
    tagCounts,
    strongestEvents: strongest.toDescendingArray(),
  };
}
