import { FixedMinHeap } from "./fixed-min-heap";
import type {
  BreakAcceptanceState,
  CompactCandle,
  LateEntryRisk,
  MomentumCondition,
  PriceBehaviour,
  PriceBehaviourEvent,
  PriceBehaviourSummary,
  PriceDirection,
  PricePhase,
} from "./types";

const EPSILON = 1e-12;

export const PRICE_BEHAVIOUR_CONFIG = Object.freeze({
  contextLookback: 80,
  impulseMaxAgeBars: 40,
  breakMaxAgeBars: 6,
  breakMinimumRangeRatio: 0.12,
  momentumAccelerationRatio: 1.25,
  momentumDecayRatio: 0.75,
  impulseMinimumMoveInRanges: 1.35,
  impulseMinimumEfficiency: 0.62,
  impulseMinimumDirectionRate: 0.6,
  impulseMinimumBodyStrength: 0.45,
  compressionMaximumRangeRatio: 0.7,
  compressionMinimumOverlap: 0.6,
  compressionMinimumNoise: 55,
  expansionMinimumRangeRatio: 1.4,
  expansionMinimumEfficiency: 0.55,
  noisyMinimumScore: 70,
  highLateEntryExtension: 4,
  mediumLateEntryExtension: 2.5,
});

const EXTREME_LOOKBACKS = [5, 10, 20] as const;

type ExtremeLookback = (typeof EXTREME_LOOKBACKS)[number];

interface PreparedSeries {
  close: Float64Array;
  high: Float64Array;
  low: Float64Array;
  range: Float64Array;
  bodyStrength: Float64Array;
  overlapPrevious: Float64Array;
  changeSign: Int8Array;
  prefixAbsoluteChange: Float64Array;
  prefixRange: Float64Array;
  prefixBodyStrength: Float64Array;
  prefixOverlap: Float64Array;
  prefixAlternation: Uint32Array;
  prefixBullishChanges: Uint32Array;
  prefixBearishChanges: Uint32Array;
  previousHigh: Record<ExtremeLookback, Float64Array>;
  previousLow: Record<ExtremeLookback, Float64Array>;
}

interface ProgressSnapshot {
  net: number;
  gross: number;
  efficiency: number;
  speed: number;
  direction: PriceDirection;
  bars: number;
}

interface ActiveImpulse {
  direction: Exclude<PriceDirection, "NEUTRAL">;
  startIndex: number;
  detectedIndex: number;
  startPrice: number;
  extremePrice: number;
  extremeIndex: number;
  impulseMove: number;
  strength: number;
  pullbackStartIndex: number | null;
  pullbackExtremePrice: number | null;
  pullbackExtremeIndex: number | null;
  recoveryStartIndex: number | null;
}

interface ActiveBreak {
  direction: Exclude<PriceDirection, "NEUTRAL">;
  level: number;
  lookback: ExtremeLookback;
  startedIndex: number;
  holdBars: number;
  accepted: boolean;
}

interface EngineState {
  impulse: ActiveImpulse | null;
  activeBreak: ActiveBreak | null;
}

const PRICE_PHASES: readonly PricePhase[] = [
  "BALANCED",
  "NOISY",
  "COMPRESSION",
  "EXPANSION",
  "BULLISH_IMPULSE",
  "BEARISH_IMPULSE",
  "BULLISH_PULLBACK",
  "BEARISH_PULLBACK",
  "BULLISH_RECOVERY",
  "BEARISH_RECOVERY",
  "MOMENTUM_DECAY",
];

const BREAK_STATES: readonly BreakAcceptanceState[] = [
  "NONE",
  "BULLISH_ATTEMPT",
  "BEARISH_ATTEMPT",
  "BULLISH_ACCEPTED",
  "BEARISH_ACCEPTED",
  "BULLISH_FAILED",
  "BEARISH_FAILED",
  "BOTH_SIDES_FAILED",
];

const MOMENTUM_CONDITIONS: readonly MomentumCondition[] = [
  "NEUTRAL",
  "STEADY_BULLISH",
  "STEADY_BEARISH",
  "ACCELERATING_BULLISH",
  "ACCELERATING_BEARISH",
  "DECAYING_BULLISH",
  "DECAYING_BEARISH",
];

const LATE_ENTRY_RISKS: readonly LateEntryRisk[] = ["LOW", "MEDIUM", "HIGH"];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1e10) / 1e10;
}

function stableNullable(value: number | null): number | null {
  return value === null ? null : stableNumber(value);
}

function directionOf(value: number): PriceDirection {
  if (value > EPSILON) return "BULLISH";
  if (value < -EPSILON) return "BEARISH";
  return "NEUTRAL";
}

function safeRatio(numerator: number, denominator: number): number | null {
  return Math.abs(denominator) > EPSILON ? numerator / denominator : null;
}

function sumBetween(prefix: Float64Array | Uint32Array, from: number, to: number): number {
  return prefix[to] - prefix[from];
}

function buildPreviousExtremes(
  values: Float64Array,
  lookback: number,
  mode: "MAX" | "MIN",
): Float64Array {
  const result = new Float64Array(values.length);
  result.fill(Number.NaN);
  const deque = new Int32Array(values.length);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < values.length; index += 1) {
    const oldestAllowed = index - lookback;
    while (head < tail && deque[head] < oldestAllowed) head += 1;

    if (head < tail) result[index] = values[deque[head]];

    if (mode === "MAX") {
      while (head < tail && values[deque[tail - 1]] <= values[index]) tail -= 1;
    } else {
      while (head < tail && values[deque[tail - 1]] >= values[index]) tail -= 1;
    }
    deque[tail] = index;
    tail += 1;
  }

  return result;
}

function prepareSeries(candles: readonly CompactCandle[]): PreparedSeries {
  const length = candles.length;
  const close = new Float64Array(length);
  const high = new Float64Array(length);
  const low = new Float64Array(length);
  const range = new Float64Array(length);
  const bodyStrength = new Float64Array(length);
  const overlapPrevious = new Float64Array(length);
  const changeSign = new Int8Array(length);
  const prefixAbsoluteChange = new Float64Array(length + 1);
  const prefixRange = new Float64Array(length + 1);
  const prefixBodyStrength = new Float64Array(length + 1);
  const prefixOverlap = new Float64Array(length + 1);
  const prefixAlternation = new Uint32Array(length + 1);
  const prefixBullishChanges = new Uint32Array(length + 1);
  const prefixBearishChanges = new Uint32Array(length + 1);

  for (let index = 0; index < length; index += 1) {
    const candle = candles[index];
    const candleRange = Math.max(0, candle[2] - candle[3]);
    const body = Math.abs(candle[4] - candle[1]);
    close[index] = candle[4];
    high[index] = candle[2];
    low[index] = candle[3];
    range[index] = candleRange;
    bodyStrength[index] = safeRatio(body, candleRange) ?? 0;

    let absoluteChange = 0;
    let overlap = 0;
    let sign = 0;
    let alternation = 0;
    if (index > 0) {
      const change = candle[4] - candles[index - 1][4];
      absoluteChange = Math.abs(change);
      sign = change > EPSILON ? 1 : change < -EPSILON ? -1 : 0;
      const previousRange = Math.max(0, candles[index - 1][2] - candles[index - 1][3]);
      const overlapDistance = Math.max(
        0,
        Math.min(candle[2], candles[index - 1][2]) -
          Math.max(candle[3], candles[index - 1][3]),
      );
      overlap = safeRatio(overlapDistance, Math.min(candleRange, previousRange)) ?? 0;
      const previousSign = changeSign[index - 1];
      alternation = sign !== 0 && previousSign !== 0 && sign !== previousSign ? 1 : 0;
    }
    overlapPrevious[index] = overlap;
    changeSign[index] = sign;
    prefixAbsoluteChange[index + 1] = prefixAbsoluteChange[index] + absoluteChange;
    prefixRange[index + 1] = prefixRange[index] + candleRange;
    prefixBodyStrength[index + 1] = prefixBodyStrength[index] + bodyStrength[index];
    prefixOverlap[index + 1] = prefixOverlap[index] + overlap;
    prefixAlternation[index + 1] = prefixAlternation[index] + alternation;
    prefixBullishChanges[index + 1] = prefixBullishChanges[index] + (sign > 0 ? 1 : 0);
    prefixBearishChanges[index + 1] = prefixBearishChanges[index] + (sign < 0 ? 1 : 0);
  }

  const previousHigh = {} as Record<ExtremeLookback, Float64Array>;
  const previousLow = {} as Record<ExtremeLookback, Float64Array>;
  for (const lookback of EXTREME_LOOKBACKS) {
    previousHigh[lookback] = buildPreviousExtremes(high, lookback, "MAX");
    previousLow[lookback] = buildPreviousExtremes(low, lookback, "MIN");
  }

  return {
    close,
    high,
    low,
    range,
    bodyStrength,
    overlapPrevious,
    changeSign,
    prefixAbsoluteChange,
    prefixRange,
    prefixBodyStrength,
    prefixOverlap,
    prefixAlternation,
    prefixBullishChanges,
    prefixBearishChanges,
    previousHigh,
    previousLow,
  };
}

function progressAt(prepared: PreparedSeries, index: number, lookback: number): ProgressSnapshot {
  const start = Math.max(0, index - lookback);
  const bars = index - start;
  if (bars <= 0) {
    return { net: 0, gross: 0, efficiency: 0, speed: 0, direction: "NEUTRAL", bars: 0 };
  }

  const net = prepared.close[index] - prepared.close[start];
  const gross = sumBetween(prepared.prefixAbsoluteChange, start + 1, index + 1);
  return {
    net,
    gross,
    efficiency: safeRatio(Math.abs(net), gross) ?? 0,
    speed: Math.abs(net) / bars,
    direction: directionOf(net),
    bars,
  };
}

function averagePriorRange(prepared: PreparedSeries, index: number, lookback: number): number {
  const start = Math.max(0, index - lookback);
  const count = index - start;
  return count > 0 ? sumBetween(prepared.prefixRange, start, index) / count : 0;
}

function averageRecent(
  prefix: Float64Array | Uint32Array,
  index: number,
  lookback: number,
  skipCurrent = false,
): number {
  const end = skipCurrent ? index : index + 1;
  const start = Math.max(0, end - lookback);
  const count = end - start;
  return count > 0 ? sumBetween(prefix, start, end) / count : 0;
}

function directionRate(prepared: PreparedSeries, index: number, lookback: number, direction: PriceDirection): number {
  const start = Math.max(1, index - lookback + 1);
  const end = index + 1;
  const count = end - start;
  if (count <= 0 || direction === "NEUTRAL") return 0;
  const prefix = direction === "BULLISH" ? prepared.prefixBullishChanges : prepared.prefixBearishChanges;
  return sumBetween(prefix, start, end) / count;
}

function momentumAt(
  prepared: PreparedSeries,
  index: number,
  progress3: ProgressSnapshot,
): { condition: MomentumCondition; ratio: number | null } {
  if (index < 6 || progress3.direction === "NEUTRAL") {
    return { condition: "NEUTRAL", ratio: null };
  }

  const currentStart = index - 3;
  const priorStart = index - 6;
  const currentNet = prepared.close[index] - prepared.close[currentStart];
  const priorNet = prepared.close[currentStart] - prepared.close[priorStart];
  const currentDirection = directionOf(currentNet);
  const priorDirection = directionOf(priorNet);
  const currentVelocity = Math.abs(currentNet) / 3;
  const priorVelocity = Math.abs(priorNet) / 3;
  const ratio = priorVelocity > EPSILON ? currentVelocity / priorVelocity : currentVelocity > EPSILON ? 3 : 1;

  if (currentDirection === "NEUTRAL") return { condition: "NEUTRAL", ratio };
  const sameDirection = currentDirection === priorDirection;
  const directional = progress3.efficiency >= 0.55;
  if (!directional) return { condition: "NEUTRAL", ratio };

  if (sameDirection && ratio >= PRICE_BEHAVIOUR_CONFIG.momentumAccelerationRatio) {
    return {
      condition: currentDirection === "BULLISH" ? "ACCELERATING_BULLISH" : "ACCELERATING_BEARISH",
      ratio,
    };
  }
  if (!sameDirection || ratio <= PRICE_BEHAVIOUR_CONFIG.momentumDecayRatio) {
    return {
      condition: currentDirection === "BULLISH" ? "DECAYING_BULLISH" : "DECAYING_BEARISH",
      ratio,
    };
  }
  return {
    condition: currentDirection === "BULLISH" ? "STEADY_BULLISH" : "STEADY_BEARISH",
    ratio,
  };
}

function detectImpulse(
  prepared: PreparedSeries,
  index: number,
  progress3: ProgressSnapshot,
  progress5: ProgressSnapshot,
  averageRange20: number,
  rangeRegimeRatio: number | null,
  momentumCondition: MomentumCondition,
): { direction: PriceDirection; strength: number; startIndex: number } {
  if (progress5.bars < 3 || averageRange20 <= EPSILON || progress5.direction === "NEUTRAL") {
    return { direction: "NEUTRAL", strength: 0, startIndex: index };
  }

  const moveInRanges = Math.abs(progress5.net) / averageRange20;
  const sameDirectionRate = directionRate(prepared, index, 5, progress5.direction);
  const recentBodyStrength = averageRecent(prepared.prefixBodyStrength, index, 3);
  const accelerating =
    (progress5.direction === "BULLISH" && momentumCondition === "ACCELERATING_BULLISH") ||
    (progress5.direction === "BEARISH" && momentumCondition === "ACCELERATING_BEARISH");
  const qualifies =
    moveInRanges >= PRICE_BEHAVIOUR_CONFIG.impulseMinimumMoveInRanges &&
    progress5.efficiency >= PRICE_BEHAVIOUR_CONFIG.impulseMinimumEfficiency &&
    sameDirectionRate >= PRICE_BEHAVIOUR_CONFIG.impulseMinimumDirectionRate &&
    recentBodyStrength >= PRICE_BEHAVIOUR_CONFIG.impulseMinimumBodyStrength &&
    ((rangeRegimeRatio ?? 0) >= 1.05 || accelerating || progress3.efficiency >= 0.75);

  if (!qualifies) return { direction: "NEUTRAL", strength: 0, startIndex: index };

  const strength = clamp(
    clamp(moveInRanges / 3, 0, 1) * 35 +
      progress5.efficiency * 30 +
      sameDirectionRate * 18 +
      recentBodyStrength * 10 +
      clamp((rangeRegimeRatio ?? 1) / 2, 0, 1) * 7,
    0,
    100,
  );

  return {
    direction: progress5.direction,
    strength,
    startIndex: Math.max(0, index - progress5.bars),
  };
}

function startImpulse(
  prepared: PreparedSeries,
  index: number,
  direction: Exclude<PriceDirection, "NEUTRAL">,
  strength: number,
  startIndex: number,
): ActiveImpulse {
  const startPrice = prepared.close[startIndex];
  const extremePrice = direction === "BULLISH" ? prepared.high[index] : prepared.low[index];
  return {
    direction,
    startIndex,
    detectedIndex: index,
    startPrice,
    extremePrice,
    extremeIndex: index,
    impulseMove: Math.max(EPSILON, Math.abs(extremePrice - startPrice)),
    strength,
    pullbackStartIndex: null,
    pullbackExtremePrice: null,
    pullbackExtremeIndex: null,
    recoveryStartIndex: null,
  };
}

function strongestBrokenLookback(
  prepared: PreparedSeries,
  index: number,
  direction: Exclude<PriceDirection, "NEUTRAL">,
  minimumBreakDistance: number,
): { lookback: 0 | ExtremeLookback; level: number | null } {
  for (let cursor = EXTREME_LOOKBACKS.length - 1; cursor >= 0; cursor -= 1) {
    const lookback = EXTREME_LOOKBACKS[cursor];
    const level = direction === "BULLISH"
      ? prepared.previousHigh[lookback][index]
      : prepared.previousLow[lookback][index];
    if (!Number.isFinite(level)) continue;
    const broken = direction === "BULLISH"
      ? prepared.high[index] - level >= minimumBreakDistance
      : level - prepared.low[index] >= minimumBreakDistance;
    if (broken) return { lookback, level };
  }
  return { lookback: 0, level: null };
}

function updateBreakState(
  prepared: PreparedSeries,
  index: number,
  state: EngineState,
  averageRange20: number,
): {
  breakState: BreakAcceptanceState;
  breakLevel: number | null;
  breakLookback: 0 | 5 | 10 | 20;
  breakAgeBars: number;
} {
  let outputState: BreakAcceptanceState = "NONE";
  let outputLevel: number | null = null;
  let outputLookback: 0 | 5 | 10 | 20 = 0;
  let outputAge = 0;

  if (state.activeBreak) {
    const active = state.activeBreak;
    const age = index - active.startedIndex;
    outputLevel = active.level;
    outputLookback = active.lookback;
    outputAge = age;

    const held = active.direction === "BULLISH"
      ? prepared.close[index] > active.level
      : prepared.close[index] < active.level;

    if (!held) {
      outputState = active.direction === "BULLISH" ? "BULLISH_FAILED" : "BEARISH_FAILED";
      state.activeBreak = null;
    } else {
      active.holdBars += 1;
      if (active.holdBars >= 2) active.accepted = true;
      outputState = active.direction === "BULLISH"
        ? active.accepted ? "BULLISH_ACCEPTED" : "BULLISH_ATTEMPT"
        : active.accepted ? "BEARISH_ACCEPTED" : "BEARISH_ATTEMPT";
      if (age >= PRICE_BEHAVIOUR_CONFIG.breakMaxAgeBars) state.activeBreak = null;
    }
  }

  if (outputState !== "NONE") {
    return {
      breakState: outputState,
      breakLevel: outputLevel,
      breakLookback: outputLookback,
      breakAgeBars: outputAge,
    };
  }

  const minimumBreakDistance = Math.max(averageRange20 * PRICE_BEHAVIOUR_CONFIG.breakMinimumRangeRatio, EPSILON);
  const bullish = strongestBrokenLookback(prepared, index, "BULLISH", minimumBreakDistance);
  const bearish = strongestBrokenLookback(prepared, index, "BEARISH", minimumBreakDistance);
  const bullishBroken = bullish.lookback > 0 && bullish.level !== null;
  const bearishBroken = bearish.lookback > 0 && bearish.level !== null;

  if (bullishBroken && bearishBroken) {
    const bullishHeld = prepared.close[index] > bullish.level!;
    const bearishHeld = prepared.close[index] < bearish.level!;
    if (!bullishHeld && !bearishHeld) {
      state.activeBreak = null;
      return {
        breakState: "BOTH_SIDES_FAILED",
        breakLevel: null,
        breakLookback: Math.max(bullish.lookback, bearish.lookback) as 5 | 10 | 20,
        breakAgeBars: 0,
      };
    }
  }

  if (bullishBroken && bullish.level !== null) {
    if (prepared.close[index] <= bullish.level) {
      return {
        breakState: "BULLISH_FAILED",
        breakLevel: bullish.level,
        breakLookback: bullish.lookback,
        breakAgeBars: 0,
      };
    }
    if (!state.activeBreak || state.activeBreak.direction !== "BULLISH" || bullish.level > state.activeBreak.level) {
      state.activeBreak = {
        direction: "BULLISH",
        level: bullish.level,
        lookback: bullish.lookback as ExtremeLookback,
        startedIndex: index,
        holdBars: 1,
        accepted: false,
      };
      return {
        breakState: "BULLISH_ATTEMPT",
        breakLevel: bullish.level,
        breakLookback: bullish.lookback,
        breakAgeBars: 0,
      };
    }
  }

  if (bearishBroken && bearish.level !== null) {
    if (prepared.close[index] >= bearish.level) {
      return {
        breakState: "BEARISH_FAILED",
        breakLevel: bearish.level,
        breakLookback: bearish.lookback,
        breakAgeBars: 0,
      };
    }
    if (!state.activeBreak || state.activeBreak.direction !== "BEARISH" || bearish.level < state.activeBreak.level) {
      state.activeBreak = {
        direction: "BEARISH",
        level: bearish.level,
        lookback: bearish.lookback as ExtremeLookback,
        startedIndex: index,
        holdBars: 1,
        accepted: false,
      };
      return {
        breakState: "BEARISH_ATTEMPT",
        breakLevel: bearish.level,
        breakLookback: bearish.lookback,
        breakAgeBars: 0,
      };
    }
  }

  return {
    breakState: outputState,
    breakLevel: outputLevel,
    breakLookback: outputLookback,
    breakAgeBars: outputAge,
  };
}

function updateImpulseState(
  prepared: PreparedSeries,
  index: number,
  state: EngineState,
  impulseCandidate: { direction: PriceDirection; strength: number; startIndex: number },
  momentumCondition: MomentumCondition,
  averageRange20: number,
): {
  phase: PricePhase;
  impulseDirection: PriceDirection;
  impulseStrength: number;
  impulseBars: number;
  pullbackDepthPercent: number | null;
  pullbackBars: number;
  recoverySpeedRatio: number | null;
  extensionVsAverageRange20: number | null;
  freshnessScore: number;
} {
  if (impulseCandidate.direction !== "NEUTRAL") {
    const direction = impulseCandidate.direction;
    const shouldRestart =
      !state.impulse ||
      state.impulse.direction !== direction ||
      index - state.impulse.detectedIndex > PRICE_BEHAVIOUR_CONFIG.impulseMaxAgeBars;
    if (shouldRestart) {
      state.impulse = startImpulse(
        prepared,
        index,
        direction,
        impulseCandidate.strength,
        impulseCandidate.startIndex,
      );
    } else {
      const existing = state.impulse;
      if (existing) existing.strength = Math.max(existing.strength, impulseCandidate.strength);
    }
  }

  const active = state.impulse;
  if (!active) {
    return {
      phase: "BALANCED",
      impulseDirection: "NEUTRAL",
      impulseStrength: 0,
      impulseBars: 0,
      pullbackDepthPercent: null,
      pullbackBars: 0,
      recoverySpeedRatio: null,
      extensionVsAverageRange20: null,
      freshnessScore: 0,
    };
  }

  const previousClose = index > 0 ? prepared.close[index - 1] : prepared.close[index];
  let phase: PricePhase = active.direction === "BULLISH" ? "BULLISH_IMPULSE" : "BEARISH_IMPULSE";

  if (active.direction === "BULLISH") {
    if (prepared.high[index] > active.extremePrice + EPSILON) {
      active.extremePrice = prepared.high[index];
      active.extremeIndex = index;
      active.impulseMove = Math.max(active.impulseMove, active.extremePrice - active.startPrice);
      active.pullbackStartIndex = null;
      active.pullbackExtremePrice = null;
      active.pullbackExtremeIndex = null;
      active.recoveryStartIndex = null;
      phase = "BULLISH_IMPULSE";
    } else if (prepared.close[index] < previousClose - EPSILON || prepared.low[index] < prepared.low[Math.max(0, index - 1)]) {
      if (active.pullbackStartIndex === null) active.pullbackStartIndex = index;
      if (active.pullbackExtremePrice === null || prepared.low[index] < active.pullbackExtremePrice) {
        active.pullbackExtremePrice = prepared.low[index];
        active.pullbackExtremeIndex = index;
      }
      phase = "BULLISH_PULLBACK";
    } else if (active.pullbackStartIndex !== null && prepared.close[index] > previousClose + EPSILON) {
      if (active.recoveryStartIndex === null) active.recoveryStartIndex = index;
      phase = "BULLISH_RECOVERY";
    }
  } else {
    if (prepared.low[index] < active.extremePrice - EPSILON) {
      active.extremePrice = prepared.low[index];
      active.extremeIndex = index;
      active.impulseMove = Math.max(active.impulseMove, active.startPrice - active.extremePrice);
      active.pullbackStartIndex = null;
      active.pullbackExtremePrice = null;
      active.pullbackExtremeIndex = null;
      active.recoveryStartIndex = null;
      phase = "BEARISH_IMPULSE";
    } else if (prepared.close[index] > previousClose + EPSILON || prepared.high[index] > prepared.high[Math.max(0, index - 1)]) {
      if (active.pullbackStartIndex === null) active.pullbackStartIndex = index;
      if (active.pullbackExtremePrice === null || prepared.high[index] > active.pullbackExtremePrice) {
        active.pullbackExtremePrice = prepared.high[index];
        active.pullbackExtremeIndex = index;
      }
      phase = "BEARISH_PULLBACK";
    } else if (active.pullbackStartIndex !== null && prepared.close[index] < previousClose - EPSILON) {
      if (active.recoveryStartIndex === null) active.recoveryStartIndex = index;
      phase = "BEARISH_RECOVERY";
    }
  }

  const impulseBars = Math.max(1, index - active.startIndex + 1);
  let pullbackDepthPercent: number | null = null;
  let pullbackBars = 0;
  let recoverySpeedRatio: number | null = null;
  if (
    active.pullbackStartIndex !== null &&
    active.pullbackExtremePrice !== null &&
    active.pullbackExtremeIndex !== null
  ) {
    const pullbackDistance = active.direction === "BULLISH"
      ? active.extremePrice - active.pullbackExtremePrice
      : active.pullbackExtremePrice - active.extremePrice;
    pullbackDepthPercent = clamp((pullbackDistance / Math.max(active.impulseMove, EPSILON)) * 100, 0, 250);
    pullbackBars = Math.max(1, active.pullbackExtremeIndex - active.pullbackStartIndex + 1);

    if (active.recoveryStartIndex !== null) {
      const recoveryDistance = active.direction === "BULLISH"
        ? prepared.close[index] - active.pullbackExtremePrice
        : active.pullbackExtremePrice - prepared.close[index];
      const recoveryBars = Math.max(1, index - active.recoveryStartIndex + 1);
      const pullbackSpeed = pullbackDistance / pullbackBars;
      const recoverySpeed = Math.max(0, recoveryDistance) / recoveryBars;
      recoverySpeedRatio = safeRatio(recoverySpeed, pullbackSpeed);
    }
  }

  const extensionVsAverageRange20 = averageRange20 > EPSILON
    ? Math.abs(prepared.close[index] - active.startPrice) / averageRange20
    : null;
  const age = index - active.detectedIndex;
  const momentumPenalty = momentumCondition.startsWith("DECAYING") ? 20 : 0;
  const pullbackPenalty = (pullbackDepthPercent ?? 0) * 0.22;
  const extensionPenalty = Math.max(0, (extensionVsAverageRange20 ?? 0) - 1.5) * 10;
  const recoveryBonus = phase.endsWith("RECOVERY") && (recoverySpeedRatio ?? 0) > 1 ? 10 : 0;
  const freshnessScore = clamp(
    100 - age * 5 - momentumPenalty - pullbackPenalty - extensionPenalty + recoveryBonus,
    0,
    100,
  );

  const invalidated = active.direction === "BULLISH"
    ? prepared.close[index] <= active.startPrice - averageRange20 * 0.1
    : prepared.close[index] >= active.startPrice + averageRange20 * 0.1;
  if (invalidated || age > PRICE_BEHAVIOUR_CONFIG.impulseMaxAgeBars || (pullbackDepthPercent ?? 0) > 120) {
    state.impulse = null;
  }

  return {
    phase,
    impulseDirection: active.direction,
    impulseStrength: active.strength,
    impulseBars,
    pullbackDepthPercent,
    pullbackBars,
    recoverySpeedRatio,
    extensionVsAverageRange20,
    freshnessScore,
  };
}

function fallbackPhase(
  basePhase: PricePhase,
  noiseScore: number,
  rangeRegimeRatio: number | null,
  averageOverlap5: number,
  efficiency3: number,
  momentumCondition: MomentumCondition,
): PricePhase {
  if (basePhase !== "BALANCED") {
    if (momentumCondition.startsWith("DECAYING") && !basePhase.endsWith("PULLBACK")) {
      return "MOMENTUM_DECAY";
    }
    return basePhase;
  }
  if ((rangeRegimeRatio ?? 1) <= PRICE_BEHAVIOUR_CONFIG.compressionMaximumRangeRatio && averageOverlap5 >= PRICE_BEHAVIOUR_CONFIG.compressionMinimumOverlap && noiseScore >= PRICE_BEHAVIOUR_CONFIG.compressionMinimumNoise) {
    return "COMPRESSION";
  }
  if ((rangeRegimeRatio ?? 1) >= PRICE_BEHAVIOUR_CONFIG.expansionMinimumRangeRatio && efficiency3 >= PRICE_BEHAVIOUR_CONFIG.expansionMinimumEfficiency) return "EXPANSION";
  if (noiseScore >= PRICE_BEHAVIOUR_CONFIG.noisyMinimumScore) return "NOISY";
  return "BALANCED";
}

function lateEntryRiskOf(
  freshnessScore: number,
  extensionVsAverageRange20: number | null,
  momentumCondition: MomentumCondition,
  pullbackDepthPercent: number | null,
): LateEntryRisk {
  if (extensionVsAverageRange20 === null && freshnessScore === 0) return "LOW";
  const extension = extensionVsAverageRange20 ?? 0;
  if (
    extension >= PRICE_BEHAVIOUR_CONFIG.highLateEntryExtension ||
    freshnessScore < 30 ||
    (momentumCondition.startsWith("DECAYING") && extension >= PRICE_BEHAVIOUR_CONFIG.mediumLateEntryExtension)
  ) {
    return "HIGH";
  }
  if (extension >= PRICE_BEHAVIOUR_CONFIG.mediumLateEntryExtension || freshnessScore < 60 || (pullbackDepthPercent ?? 0) >= 65) {
    return "MEDIUM";
  }
  return "LOW";
}

export function forEachPriceBehaviour(
  candles: readonly CompactCandle[],
  callback: (feature: PriceBehaviour, index: number) => void,
): void {
  if (candles.length === 0) return;
  const prepared = prepareSeries(candles);
  const state: EngineState = { impulse: null, activeBreak: null };

  for (let index = 0; index < candles.length; index += 1) {
    const progress3 = progressAt(prepared, index, 3);
    const progress5 = progressAt(prepared, index, 5);
    const progress10 = progressAt(prepared, index, 10);
    const progress20 = progressAt(prepared, index, 20);
    const averageRange20 = averagePriorRange(prepared, index, 20);
    const recentRange3 = averageRecent(prepared.prefixRange, index, 3);
    const rangeRegimeRatio = averageRange20 > EPSILON ? recentRange3 / averageRange20 : null;
    const averageOverlap5 = averageRecent(prepared.prefixOverlap, index, 5);
    const alternationRate5 = averageRecent(prepared.prefixAlternation, index, 5);
    const noiseScore = clamp(
      (1 - progress5.efficiency) * 45 + averageOverlap5 * 35 + alternationRate5 * 20,
      0,
      100,
    );
    const momentum = momentumAt(prepared, index, progress3);
    const impulseCandidate = detectImpulse(
      prepared,
      index,
      progress3,
      progress5,
      averageRange20,
      rangeRegimeRatio,
      momentum.condition,
    );
    const impulse = updateImpulseState(
      prepared,
      index,
      state,
      impulseCandidate,
      momentum.condition,
      averageRange20,
    );
    const breakResult = updateBreakState(prepared, index, state, averageRange20);
    const phase = fallbackPhase(
      impulse.phase,
      noiseScore,
      rangeRegimeRatio,
      averageOverlap5,
      progress3.efficiency,
      momentum.condition,
    );
    const lateEntryRisk = lateEntryRiskOf(
      impulse.freshnessScore,
      impulse.extensionVsAverageRange20,
      momentum.condition,
      impulse.pullbackDepthPercent,
    );

    callback(
      {
        timestampMs: candles[index][0],
        netProgress3: stableNumber(progress3.net),
        netProgress5: stableNumber(progress5.net),
        netProgress10: stableNumber(progress10.net),
        netProgress20: stableNumber(progress20.net),
        grossTravel5: stableNumber(progress5.gross),
        grossTravel20: stableNumber(progress20.gross),
        efficiency3: stableNumber(progress3.efficiency),
        efficiency5: stableNumber(progress5.efficiency),
        efficiency10: stableNumber(progress10.efficiency),
        efficiency20: stableNumber(progress20.efficiency),
        speed3: stableNumber(progress3.speed),
        speed5: stableNumber(progress5.speed),
        speed10: stableNumber(progress10.speed),
        speed20: stableNumber(progress20.speed),
        averageOverlap5: stableNumber(averageOverlap5),
        alternationRate5: stableNumber(alternationRate5),
        noiseScore: stableNumber(noiseScore),
        rangeRegimeRatio: stableNullable(rangeRegimeRatio),
        phase,
        impulseDirection: impulse.impulseDirection,
        impulseStrength: stableNumber(impulse.impulseStrength),
        impulseBars: impulse.impulseBars,
        pullbackDepthPercent: stableNullable(impulse.pullbackDepthPercent),
        pullbackBars: impulse.pullbackBars,
        recoverySpeedRatio: stableNullable(impulse.recoverySpeedRatio),
        breakState: breakResult.breakState,
        breakLevel: stableNullable(breakResult.breakLevel),
        breakLookback: breakResult.breakLookback,
        breakAgeBars: breakResult.breakAgeBars,
        momentumCondition: momentum.condition,
        accelerationRatio: stableNullable(momentum.ratio),
        extensionVsAverageRange20: stableNullable(impulse.extensionVsAverageRange20),
        freshnessScore: stableNumber(impulse.freshnessScore),
        lateEntryRisk,
      },
      index,
    );
  }
}

export function analyzePriceBehaviourWindow(
  candles: readonly CompactCandle[],
  requestedOffset: number,
  requestedLimit: number,
): PriceBehaviour[] {
  const total = candles.length;
  const offset = Math.max(0, Math.min(total, Math.floor(requestedOffset)));
  const limit = Math.max(0, Math.floor(requestedLimit));
  const end = Math.min(total, offset + limit);
  if (end <= offset) return [];

  const contextStart = Math.max(0, offset - PRICE_BEHAVIOUR_CONFIG.contextLookback);
  const context = candles.slice(contextStart, end);
  const result: PriceBehaviour[] = [];
  const localOffset = offset - contextStart;
  forEachPriceBehaviour(context, (feature, localIndex) => {
    if (localIndex >= localOffset) result.push(feature);
  });
  return result;
}

function createCountRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function eventScore(feature: PriceBehaviour): number {
  const breakScore = feature.breakState.endsWith("ACCEPTED")
    ? 82
    : feature.breakState.endsWith("FAILED") || feature.breakState === "BOTH_SIDES_FAILED"
      ? 76
      : feature.breakState.endsWith("ATTEMPT")
        ? 58
        : 0;
  const momentumScore = feature.momentumCondition.startsWith("ACCELERATING")
    ? clamp((feature.accelerationRatio ?? 1) * 28, 0, 88)
    : feature.momentumCondition.startsWith("DECAYING")
      ? 52
      : 0;
  const phaseScore = feature.phase === "EXPANSION"
    ? 68
    : feature.phase.endsWith("RECOVERY")
      ? 72
      : feature.phase.endsWith("PULLBACK")
        ? 60
        : 0;
  return Math.max(feature.impulseStrength, breakScore, momentumScore, phaseScore);
}

export function summarizePriceBehaviour(
  candles: readonly CompactCandle[],
  strongestLimit = 20,
): PriceBehaviourSummary {
  const phaseCounts = createCountRecord(PRICE_PHASES);
  const breakStateCounts = createCountRecord(BREAK_STATES);
  const momentumCounts = createCountRecord(MOMENTUM_CONDITIONS);
  const lateEntryRiskCounts = createCountRecord(LATE_ENTRY_RISKS);
  const strongest = new FixedMinHeap<PriceBehaviourEvent>(strongestLimit, (event) => event.score);

  let efficiency5Total = 0;
  let efficiency20Total = 0;
  let noiseTotal = 0;
  let impulseStrengthTotal = 0;
  let pullbackDepthTotal = 0;
  let recoveryRatioTotal = 0;
  let pullbackSampleCount = 0;
  let recoverySampleCount = 0;

  forEachPriceBehaviour(candles, (feature) => {
    efficiency5Total += feature.efficiency5;
    efficiency20Total += feature.efficiency20;
    noiseTotal += feature.noiseScore;
    impulseStrengthTotal += feature.impulseStrength;
    phaseCounts[feature.phase] += 1;
    breakStateCounts[feature.breakState] += 1;
    momentumCounts[feature.momentumCondition] += 1;
    lateEntryRiskCounts[feature.lateEntryRisk] += 1;

    if (feature.pullbackDepthPercent !== null) {
      pullbackDepthTotal += feature.pullbackDepthPercent;
      pullbackSampleCount += 1;
    }
    if (feature.recoverySpeedRatio !== null && Number.isFinite(feature.recoverySpeedRatio)) {
      recoveryRatioTotal += feature.recoverySpeedRatio;
      recoverySampleCount += 1;
    }

    const score = eventScore(feature);
    if (score >= 50) {
      strongest.push({
        timestampMs: feature.timestampMs,
        phase: feature.phase,
        score,
        impulseDirection: feature.impulseDirection,
        impulseStrength: feature.impulseStrength,
        breakState: feature.breakState,
        momentumCondition: feature.momentumCondition,
        lateEntryRisk: feature.lateEntryRisk,
      });
    }
  });

  const count = candles.length;
  return {
    candleCount: count,
    averageEfficiency5: count > 0 ? efficiency5Total / count : 0,
    averageEfficiency20: count > 0 ? efficiency20Total / count : 0,
    averageNoiseScore: count > 0 ? noiseTotal / count : 0,
    averageImpulseStrength: count > 0 ? impulseStrengthTotal / count : 0,
    averagePullbackDepthPercent: pullbackSampleCount > 0 ? pullbackDepthTotal / pullbackSampleCount : 0,
    averageRecoverySpeedRatio: recoverySampleCount > 0 ? recoveryRatioTotal / recoverySampleCount : 0,
    pullbackSampleCount,
    recoverySampleCount,
    phaseCounts,
    breakStateCounts,
    momentumCounts,
    lateEntryRiskCounts,
    strongestEvents: strongest.toDescendingArray(),
  };
}
