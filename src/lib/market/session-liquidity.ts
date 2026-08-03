import { FixedMinHeap } from "./fixed-min-heap";
import { getDailyBucketStart, getNextDailyBucketStart, type DailyBoundaryMode } from "./market-session";
import {
  classifyXauTradingSession,
  getSessionMembership,
  isActiveExecutionSession,
  type CoreTradingSession,
  type XauTradingSession,
} from "./trading-session";
import type {
  CompactCandle,
  LiquidityLevelSide,
  LiquidityLevelSnapshot,
  LiquidityLevelType,
  LiquiditySweepSnapshot,
  MarketLocationZone,
  ObstacleClass,
  OpportunityDirection,
  QmlReasonCode,
  QmlSetupSnapshot,
  QmlSetupStage,
  SessionLiquiditySnapshot,
  SessionLiquiditySummary,
  StructureBreakType,
  StructureShiftSnapshot,
  Timeframe,
  TimeframeDataset,
} from "./types";

const MINUTE_MS = 60_000;
const NONE = -1;
const SESSION_VALUES: readonly XauTradingSession[] = [
  "ASIA",
  "LONDON",
  "NEW_YORK",
  "LONDON_NEW_YORK_OVERLAP",
  "OFF_HOURS",
];
const LOCATION_VALUES: readonly MarketLocationZone[] = [
  "ABOVE_PREVIOUS_DAY",
  "UPPER_EXTERNAL_LIQUIDITY",
  "RANGE_UPPER_EDGE",
  "RANGE_MIDDLE",
  "RANGE_LOWER_EDGE",
  "LOWER_EXTERNAL_LIQUIDITY",
  "BELOW_PREVIOUS_DAY",
  "UNAVAILABLE",
];
const LEVEL_TYPES: readonly LiquidityLevelType[] = [
  "PREVIOUS_DAY_HIGH",
  "PREVIOUS_DAY_LOW",
  "PREVIOUS_WEEK_HIGH",
  "PREVIOUS_WEEK_LOW",
  "ASIA_HIGH",
  "ASIA_LOW",
  "LONDON_HIGH",
  "LONDON_LOW",
  "NEW_YORK_HIGH",
  "NEW_YORK_LOW",
  "M15_SWING_HIGH",
  "M15_SWING_LOW",
  "H1_SWING_HIGH",
  "H1_SWING_LOW",
  "EQUAL_HIGHS",
  "EQUAL_LOWS",
];
const QML_STAGES: readonly QmlSetupStage[] = [
  "NONE",
  "LIQUIDITY_SWEPT",
  "MSS_CONFIRMED",
  "RETEST_WAIT",
  "RETEST_CONFIRMED",
  "INVALIDATED",
  "EXPIRED",
];
const REASONS: readonly QmlReasonCode[] = [
  "IMPORTANT_LIQUIDITY_SWEPT",
  "LEVEL_RECLAIMED",
  "MSS_BODY_CLOSE",
  "DISPLACEMENT_PRESENT",
  "QML_SHOULDER_IDENTIFIED",
  "FIRST_RETEST_CONFIRMED",
  "SECOND_RETEST_CONFIRMED",
  "ACTIVE_SESSION_CONTEXT",
  "OPPOSITE_LIQUIDITY_AVAILABLE",
  "COUNTER_HTF_PRESSURE",
  "MID_RANGE_LOCATION",
  "RETEST_TOO_LATE",
  "HEAD_INVALIDATED",
  "DATA_NOT_READY",
];
const SESSION_CODE = new Map(SESSION_VALUES.map((value, index) => [value, index]));
const LOCATION_CODE = new Map(LOCATION_VALUES.map((value, index) => [value, index]));
const LEVEL_TYPE_CODE = new Map(LEVEL_TYPES.map((value, index) => [value, index]));
const QML_STAGE_CODE = new Map(QML_STAGES.map((value, index) => [value, index]));
const REASON_BIT = new Map(REASONS.map((value, index) => [value, 1 << index]));

export const SESSION_LIQUIDITY_CONFIG = Object.freeze({
  pivotRadius: 2,
  minimumWarmupD1: 5,
  minimumWarmupH1: 20,
  levelLookbackBars: 480,
  sweepCooldownBars: 24,
  minimumSweepScore: 48,
  qmlMssWindowBars: 10,
  qmlRetestWindowBars: 20,
  qmlMaximumRetests: 2,
  qmlEntryZoneAverageRange: 0.35,
  qmlHeadBufferAverageRange: 0.15,
  qmlMediumReadyScore: 62,
  strongestQmlLimit: 24,
});


interface CompletedTradingWeekRange {
  weekStartMs: number;
  formedAtMs: number;
  availableAtMs: number;
  high: number;
  low: number;
  tradingDayCount: number;
}

interface SessionRange {
  key: string;
  startMs: number;
  endMs: number;
  high: number;
  low: number;
}

interface SessionTracker {
  active: SessionRange | null;
  completed: SessionRange | null;
}

interface SwingPoint {
  index: number;
  timestampMs: number;
  price: number;
  side: LiquidityLevelSide;
  timeframe: "M1" | "M15" | "H1";
}

interface InternalLevel extends LiquidityLevelSnapshot {
  lastSweepIndex: number;
}

interface QmlRuntime {
  stage: QmlSetupStage;
  direction: Exclude<OpportunityDirection, "NEUTRAL"> | null;
  sweepEventIndex: number;
  structureEventIndex: number;
  sweepIndex: number;
  sweepLevelPrice: number;
  sweepLevelType: LiquidityLevelType | null;
  mssIndex: number;
  confirmedIndex: number;
  score: number;
  qmlLevel: number;
  shoulderPrice: number;
  headPrice: number;
  invalidationPrice: number;
  entryLower: number;
  entryUpper: number;
  targetPrice: number;
  targetType: LiquidityLevelType | null;
  retestCount: number;
  reasonMask: number;
  blockerMask: number;
  terminalStageShownAt: number;
}

interface SessionLiquidityArrays {
  session: Uint8Array;
  location: Uint8Array;
  dataReady: Uint8Array;
  previousDayHigh: Float64Array;
  previousDayLow: Float64Array;
  previousWeekHigh: Float64Array;
  previousWeekLow: Float64Array;
  asiaHigh: Float64Array;
  asiaLow: Float64Array;
  londonHigh: Float64Array;
  londonLow: Float64Array;
  newYorkHigh: Float64Array;
  newYorkLow: Float64Array;
  abovePrice: Float64Array;
  aboveType: Int8Array;
  aboveStrength: Uint8Array;
  aboveFormedAt: Float64Array;
  belowPrice: Float64Array;
  belowType: Int8Array;
  belowStrength: Uint8Array;
  belowFormedAt: Float64Array;
  sweepEvent: Int32Array;
  structureEvent: Int32Array;
  qmlStage: Uint8Array;
  qmlDirection: Uint8Array;
  qmlScore: Uint8Array;
  qmlLevel: Float64Array;
  qmlShoulder: Float64Array;
  qmlHead: Float64Array;
  qmlInvalidation: Float64Array;
  qmlEntryLower: Float64Array;
  qmlEntryUpper: Float64Array;
  qmlTarget: Float64Array;
  qmlTargetType: Int8Array;
  qmlRetestCount: Uint8Array;
  qmlSweepEvent: Int32Array;
  qmlStructureEvent: Int32Array;
  qmlAgeBars: Uint8Array;
  qmlReasonMask: Uint16Array;
  qmlBlockerMask: Uint16Array;
}

export interface SessionLiquidityIndex {
  datasets: Record<Timeframe, TimeframeDataset>;
  dailyBoundaryMode: DailyBoundaryMode;
  arrays: SessionLiquidityArrays;
  sweepEvents: LiquiditySweepSnapshot[];
  structureEvents: StructureShiftSnapshot[];
  summary: SessionLiquiditySummary;
  latest: SessionLiquiditySnapshot | null;
}

const cache = new WeakMap<object, SessionLiquidityIndex>();

function stable(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

/**
 * Resolves the Monday UTC key for the trading day represented by a D1 bucket.
 * With the New York 17:00 boundary, the bucket end minus one minute is always
 * inside the intended trading-day calendar date (including DST transitions).
 */
function tradingWeekStartForBucket(bucketStartMs: number, mode: DailyBoundaryMode): number {
  const tradingDayMarkerMs = getNextDailyBucketStart(bucketStartMs, mode) - MINUTE_MS;
  const date = new Date(tradingDayMarkerMs);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset);
}

function previousCompletedTradingWeek(
  closedDays: readonly CompactCandle[],
  currentTimestampMs: number,
  mode: DailyBoundaryMode,
): CompletedTradingWeekRange | null {
  const currentBucketStart = getDailyBucketStart(currentTimestampMs, mode);
  const currentWeekStart = tradingWeekStartForBucket(currentBucketStart, mode);
  const grouped = new Map<number, CompactCandle[]>();

  for (const candle of closedDays) {
    const weekStart = tradingWeekStartForBucket(candle[0], mode);
    if (weekStart >= currentWeekStart) continue;
    const bucket = grouped.get(weekStart);
    if (bucket) bucket.push(candle);
    else grouped.set(weekStart, [candle]);
  }

  const eligibleWeeks = [...grouped.entries()]
    .filter(([, days]) => days.length >= 3)
    .sort((a, b) => b[0] - a[0]);
  const selected = eligibleWeeks[0];
  if (!selected) return null;

  const [weekStartMs, days] = selected;
  return {
    weekStartMs,
    formedAtMs: days[0][0],
    availableAtMs: Math.max(...days.map((candle) => getNextDailyBucketStart(candle[0], mode))),
    high: Math.max(...days.map((candle) => candle[2])),
    low: Math.min(...days.map((candle) => candle[3])),
    tradingDayCount: days.length,
  };
}

function emptyFloat(size: number): Float64Array {
  const result = new Float64Array(size);
  result.fill(Number.NaN);
  return result;
}

function allocateArrays(size: number): SessionLiquidityArrays {
  const event = new Int32Array(size);
  const structure = new Int32Array(size);
  const aboveType = new Int8Array(size);
  const belowType = new Int8Array(size);
  const targetType = new Int8Array(size);
  event.fill(NONE);
  structure.fill(NONE);
  aboveType.fill(NONE);
  belowType.fill(NONE);
  targetType.fill(NONE);
  const qmlSweepEvent = new Int32Array(size);
  const qmlStructureEvent = new Int32Array(size);
  qmlSweepEvent.fill(NONE);
  qmlStructureEvent.fill(NONE);
  return {
    session: new Uint8Array(size),
    location: new Uint8Array(size),
    dataReady: new Uint8Array(size),
    previousDayHigh: emptyFloat(size),
    previousDayLow: emptyFloat(size),
    previousWeekHigh: emptyFloat(size),
    previousWeekLow: emptyFloat(size),
    asiaHigh: emptyFloat(size),
    asiaLow: emptyFloat(size),
    londonHigh: emptyFloat(size),
    londonLow: emptyFloat(size),
    newYorkHigh: emptyFloat(size),
    newYorkLow: emptyFloat(size),
    abovePrice: emptyFloat(size),
    aboveType,
    aboveStrength: new Uint8Array(size),
    aboveFormedAt: emptyFloat(size),
    belowPrice: emptyFloat(size),
    belowType,
    belowStrength: new Uint8Array(size),
    belowFormedAt: emptyFloat(size),
    sweepEvent: event,
    structureEvent: structure,
    qmlStage: new Uint8Array(size),
    qmlDirection: new Uint8Array(size),
    qmlScore: new Uint8Array(size),
    qmlLevel: emptyFloat(size),
    qmlShoulder: emptyFloat(size),
    qmlHead: emptyFloat(size),
    qmlInvalidation: emptyFloat(size),
    qmlEntryLower: emptyFloat(size),
    qmlEntryUpper: emptyFloat(size),
    qmlTarget: emptyFloat(size),
    qmlTargetType: targetType,
    qmlRetestCount: new Uint8Array(size),
    qmlSweepEvent,
    qmlStructureEvent,
    qmlAgeBars: new Uint8Array(size),
    qmlReasonMask: new Uint16Array(size),
    qmlBlockerMask: new Uint16Array(size),
  };
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function countRecord<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function reasonMask(items: readonly QmlReasonCode[]): number {
  let mask = 0;
  for (const item of items) mask |= REASON_BIT.get(item) ?? 0;
  return mask;
}

function decodeReasons(mask: number): QmlReasonCode[] {
  return REASONS.filter((reason) => (mask & (REASON_BIT.get(reason) ?? 0)) !== 0);
}

function sideForType(type: LiquidityLevelType): LiquidityLevelSide {
  return type.endsWith("HIGH") || type === "EQUAL_HIGHS" ? "HIGH" : "LOW";
}

function obstacleClassForType(type: LiquidityLevelType): ObstacleClass {
  if (type.startsWith("PREVIOUS_") || type.startsWith("H1_") || type.startsWith("ASIA_") || type.startsWith("LONDON_") || type.startsWith("NEW_YORK_")) return "HARD";
  return "MEDIUM";
}

function strengthForType(type: LiquidityLevelType): number {
  if (type.startsWith("PREVIOUS_WEEK")) return 96;
  if (type.startsWith("PREVIOUS_DAY")) return 91;
  if (type.startsWith("H1_")) return 84;
  if (type.startsWith("LONDON_") || type.startsWith("NEW_YORK_")) return 82;
  if (type.startsWith("ASIA_")) return 78;
  if (type.startsWith("EQUAL_")) return 76;
  return 68;
}

function level(
  type: LiquidityLevelType,
  price: number | null,
  formedAtMs: number,
  availableAtMs: number,
  touches = 1,
): InternalLevel | null {
  if (price === null || !Number.isFinite(price)) return null;
  return {
    id: `${type}:${formedAtMs}:${stable(price)}`,
    type,
    side: sideForType(type),
    price: stable(price),
    formedAtMs,
    availableAtMs,
    strength: strengthForType(type),
    touches,
    freshnessBars: 0,
    obstacleClass: obstacleClassForType(type),
    status: "ACTIVE",
    lastSweepIndex: NONE,
  };
}

function rangeLevel(
  range: SessionRange | null,
  session: CoreTradingSession,
  side: LiquidityLevelSide,
): InternalLevel | null {
  if (!range) return null;
  return level(
    `${session}_${side}` as LiquidityLevelType,
    side === "HIGH" ? range.high : range.low,
    range.startMs,
    range.endMs,
  );
}

function updateSessionTrackers(
  trackers: Record<CoreTradingSession, SessionTracker>,
  candle: CompactCandle,
): void {
  const membership = getSessionMembership(candle[0]);
  const sessions: readonly CoreTradingSession[] = ["ASIA", "LONDON", "NEW_YORK"];
  for (const session of sessions) {
    const tracker = trackers[session];
    if (membership.active[session]) {
      const key = membership.key[session];
      if (!tracker.active || tracker.active.key !== key) {
        if (tracker.active) tracker.completed = { ...tracker.active, endMs: candle[0] };
        tracker.active = {
          key,
          startMs: candle[0],
          endMs: candle[0] + MINUTE_MS,
          high: candle[2],
          low: candle[3],
        };
      } else {
        tracker.active.high = Math.max(tracker.active.high, candle[2]);
        tracker.active.low = Math.min(tracker.active.low, candle[3]);
        tracker.active.endMs = candle[0] + MINUTE_MS;
      }
    } else if (tracker.active) {
      tracker.completed = { ...tracker.active, endMs: candle[0] };
      tracker.active = null;
    }
  }
}

function averagePriorRange(prefix: Float64Array, index: number, lookback = 20): number {
  const start = Math.max(0, index - lookback);
  const count = index - start;
  return count > 0 ? (prefix[index] - prefix[start]) / count : 0;
}

function contextUsable(dataset: TimeframeDataset, index: number): boolean {
  if (index < 0 || index >= dataset.candles.length) return false;
  const coverage = dataset.completeness[index];
  if (!coverage) return false;
  if (coverage.status === "OVERFULL" || coverage.status === "MISSING_DATA") return false;
  if (coverage.status === "COMPLETE" || coverage.status === "EXPECTED_MARKET_CLOSURE" || coverage.status === "BOUNDARY_AND_CLOSURE") return true;
  // Context levels do not require a perfectly complete bucket. A candle with at least
  // 97% of its expected tradable children is usable for HTF location, but remains
  // ineligible for execution-time confirmation elsewhere in the engine.
  return coverage.completenessPercent >= 97;
}

function complete(dataset: TimeframeDataset, index: number): boolean {
  return contextUsable(dataset, index);
}

function isPivot(
  dataset: TimeframeDataset,
  index: number,
  side: LiquidityLevelSide,
  radius = SESSION_LIQUIDITY_CONFIG.pivotRadius,
): boolean {
  if (index < radius || index + radius >= dataset.candles.length) return false;
  for (let neighbour = index - radius; neighbour <= index + radius; neighbour += 1) {
    if (!complete(dataset, neighbour)) return false;
    if (neighbour === index) continue;
    if (side === "HIGH" && dataset.candles[index][2] < dataset.candles[neighbour][2]) return false;
    if (side === "LOW" && dataset.candles[index][3] > dataset.candles[neighbour][3]) return false;
  }
  return true;
}

function closedIndexAtOrBefore(
  dataset: TimeframeDataset,
  durationMs: number,
  timestampMs: number,
): number {
  let low = 0;
  let high = dataset.candles.length - 1;
  let answer = NONE;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (dataset.candles[middle][0] + durationMs <= timestampMs) {
      answer = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return answer;
}

function recentSwingLevel(
  swings: readonly SwingPoint[],
  type: LiquidityLevelType,
  currentIndex: number,
): InternalLevel | null {
  const side = sideForType(type);
  for (let index = swings.length - 1; index >= 0; index -= 1) {
    const swing = swings[index];
    if (swing.side !== side) continue;
    return {
      ...level(type, swing.price, swing.timestampMs, swing.timestampMs)!,
      freshnessBars: Math.max(0, currentIndex - swing.index),
    };
  }
  return null;
}

function addLevel(target: InternalLevel[], item: InternalLevel | null): void {
  if (!item) return;
  const duplicate = target.find((existing) => existing.type === item.type && Math.abs(existing.price - item.price) < 1e-8);
  if (!duplicate) target.push(item);
}

function nearestLevels(levels: readonly InternalLevel[], close: number): {
  above: InternalLevel | null;
  below: InternalLevel | null;
} {
  let above: InternalLevel | null = null;
  let below: InternalLevel | null = null;
  for (const item of levels) {
    if (item.price > close && (!above || item.price < above.price)) above = item;
    if (item.price < close && (!below || item.price > below.price)) below = item;
  }
  return { above, below };
}

function marketLocation(close: number, previousDayHigh: number | null, previousDayLow: number | null): MarketLocationZone {
  if (previousDayHigh === null || previousDayLow === null || previousDayHigh <= previousDayLow) return "UNAVAILABLE";
  const range = previousDayHigh - previousDayLow;
  if (close > previousDayHigh + range * 0.05) return "ABOVE_PREVIOUS_DAY";
  if (close < previousDayLow - range * 0.05) return "BELOW_PREVIOUS_DAY";
  const position = (close - previousDayLow) / range;
  if (position >= 0.9) return "UPPER_EXTERNAL_LIQUIDITY";
  if (position >= 0.72) return "RANGE_UPPER_EDGE";
  if (position <= 0.1) return "LOWER_EXTERNAL_LIQUIDITY";
  if (position <= 0.28) return "RANGE_LOWER_EDGE";
  return "RANGE_MIDDLE";
}

function candleDisplacementScore(candle: CompactCandle, averageRange: number): number {
  const range = Math.max(0, candle[2] - candle[3]);
  if (range <= 0) return 0;
  const body = Math.abs(candle[4] - candle[1]);
  const bodyRatio = body / range;
  const rangeRatio = averageRange > 0 ? range / averageRange : 1;
  const closeLocation = (candle[4] - candle[3]) / range;
  const directionalClose = candle[4] >= candle[1] ? closeLocation : 1 - closeLocation;
  return Math.max(0, Math.min(100, bodyRatio * 46 + Math.min(2.2, rangeRatio) / 2.2 * 34 + directionalClose * 20));
}

function bestSweep(
  levels: readonly InternalLevel[],
  candle: CompactCandle,
  candleIndex: number,
  averageRange: number,
  session: XauTradingSession,
  lastSweepByLevel: Map<string, number>,
): LiquiditySweepSnapshot | null {
  const range = Math.max(candle[2] - candle[3], 1e-9);
  const minimumPenetration = Math.max(0.01, averageRange * 0.025);
  const reclaimTolerance = Math.max(0.01, averageRange * 0.04);
  let best: LiquiditySweepSnapshot | null = null;
  for (const item of levels) {
    const last = lastSweepByLevel.get(item.id) ?? NONE;
    if (last >= 0 && candleIndex - last < SESSION_LIQUIDITY_CONFIG.sweepCooldownBars) continue;
    let direction: "BULLISH" | "BEARISH";
    let penetration: number;
    let reclaimed: boolean;
    let reclaimStrength: number;
    if (item.side === "HIGH") {
      penetration = candle[2] - item.price;
      reclaimed = penetration >= minimumPenetration && candle[4] <= item.price + reclaimTolerance;
      reclaimStrength = Math.max(0, Math.min(100, ((item.price - candle[4]) / range + 0.5) * 100));
      direction = "BEARISH";
    } else {
      penetration = item.price - candle[3];
      reclaimed = penetration >= minimumPenetration && candle[4] >= item.price - reclaimTolerance;
      reclaimStrength = Math.max(0, Math.min(100, ((candle[4] - item.price) / range + 0.5) * 100));
      direction = "BULLISH";
    }
    if (!reclaimed) continue;
    const penetrationRatio = averageRange > 0 ? penetration / averageRange : 0;
    const sessionBonus = isActiveExecutionSession(session) ? 10 : session === "ASIA" ? 5 : 1;
    const score = Math.min(100,
      item.strength * 0.42 +
      reclaimStrength * 0.32 +
      Math.min(1, penetrationRatio / 0.3) * 16 +
      sessionBonus,
    );
    const event: LiquiditySweepSnapshot = {
      timestampMs: candle[0] + MINUTE_MS,
      direction,
      levelId: item.id,
      levelType: item.type,
      levelPrice: item.price,
      penetrationDistance: stable(penetration),
      penetrationInAverageRanges: stable(penetrationRatio),
      reclaimed: true,
      reclaimStrength: stable(reclaimStrength),
      score: stable(score),
    };
    if (!best || event.score > best.score) best = event;
  }
  if (best) lastSweepByLevel.set(best.levelId, candleIndex);
  return best;
}

function structureTrend(highs: readonly SwingPoint[], lows: readonly SwingPoint[]): OpportunityDirection {
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const h1 = highs.at(-1)!;
  const h0 = highs.at(-2)!;
  const l1 = lows.at(-1)!;
  const l0 = lows.at(-2)!;
  if (h1.price > h0.price && l1.price > l0.price) return "BULLISH";
  if (h1.price < h0.price && l1.price < l0.price) return "BEARISH";
  return "NEUTRAL";
}

function detectStructureShift(
  candles: readonly CompactCandle[],
  index: number,
  averageRange: number,
  highs: readonly SwingPoint[],
  lows: readonly SwingPoint[],
  brokenSwingIds: Set<string>,
): StructureShiftSnapshot | null {
  if (index <= 0) return null;
  const candle = candles[index];
  const previousClose = candles[index - 1][4];
  const displacement = candleDisplacementScore(candle, averageRange);
  const trend = structureTrend(highs, lows);
  const high = highs.at(-1);
  const low = lows.at(-1);
  const minimumCloseBeyond = Math.max(0.01, averageRange * 0.04);
  if (high && previousClose <= high.price && candle[4] > high.price + minimumCloseBeyond) {
    const id = `H:${high.timestampMs}:${high.price}`;
    if (!brokenSwingIds.has(id)) {
      brokenSwingIds.add(id);
      const type: StructureBreakType = trend === "BEARISH" ? "MSS" : "BOS";
      return {
        timestampMs: candle[0] + MINUTE_MS,
        direction: "BULLISH",
        type,
        brokenSwingPrice: stable(high.price),
        brokenSwingTimestampMs: high.timestampMs,
        closeBeyondDistance: stable(candle[4] - high.price),
        displacementScore: stable(displacement),
        score: stable(Math.min(100, (type === "MSS" ? 48 : 38) + displacement * 0.52)),
      };
    }
  }
  if (low && previousClose >= low.price && candle[4] < low.price - minimumCloseBeyond) {
    const id = `L:${low.timestampMs}:${low.price}`;
    if (!brokenSwingIds.has(id)) {
      brokenSwingIds.add(id);
      const type: StructureBreakType = trend === "BULLISH" ? "MSS" : "BOS";
      return {
        timestampMs: candle[0] + MINUTE_MS,
        direction: "BEARISH",
        type,
        brokenSwingPrice: stable(low.price),
        brokenSwingTimestampMs: low.timestampMs,
        closeBeyondDistance: stable(low.price - candle[4]),
        displacementScore: stable(displacement),
        score: stable(Math.min(100, (type === "MSS" ? 48 : 38) + displacement * 0.52)),
      };
    }
  }
  return null;
}

function previousShoulder(
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  sweepIndex: number,
  highs: readonly SwingPoint[],
  lows: readonly SwingPoint[],
): SwingPoint | null {
  const source = direction === "BEARISH" ? highs : lows;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source[index].index < sweepIndex) return source[index];
  }
  return null;
}

function targetForDirection(
  direction: Exclude<OpportunityDirection, "NEUTRAL">,
  levels: readonly InternalLevel[],
  entry: number,
  postShiftPrice: number,
  averageRange: number,
): { price: number; type: LiquidityLevelType | null } {
  const beyond = direction === "BULLISH"
    ? Math.max(entry, postShiftPrice) + averageRange * 0.2
    : Math.min(entry, postShiftPrice) - averageRange * 0.2;
  const candidates = levels
    .filter((item) => direction === "BULLISH"
      ? item.side === "HIGH" && item.price > beyond
      : item.side === "LOW" && item.price < beyond)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  const preferred = candidates.find((item) => item.obstacleClass === "HARD") ?? candidates[0];
  if (preferred) return { price: preferred.price, type: preferred.type };
  const fallbackBase = direction === "BULLISH" ? Math.max(entry, postShiftPrice) : Math.min(entry, postShiftPrice);
  return {
    price: stable(fallbackBase + (direction === "BULLISH" ? 1 : -1) * Math.max(averageRange * 3, 0.5)),
    type: null,
  };
}

function resetQml(runtime: QmlRuntime): void {
  runtime.stage = "NONE";
  runtime.direction = null;
  runtime.sweepEventIndex = NONE;
  runtime.structureEventIndex = NONE;
  runtime.sweepIndex = NONE;
  runtime.sweepLevelPrice = Number.NaN;
  runtime.sweepLevelType = null;
  runtime.mssIndex = NONE;
  runtime.confirmedIndex = NONE;
  runtime.score = 0;
  runtime.qmlLevel = Number.NaN;
  runtime.shoulderPrice = Number.NaN;
  runtime.headPrice = Number.NaN;
  runtime.invalidationPrice = Number.NaN;
  runtime.entryLower = Number.NaN;
  runtime.entryUpper = Number.NaN;
  runtime.targetPrice = Number.NaN;
  runtime.targetType = null;
  runtime.retestCount = 0;
  runtime.reasonMask = 0;
  runtime.blockerMask = 0;
  runtime.terminalStageShownAt = NONE;
}

function newQmlRuntime(): QmlRuntime {
  const runtime = {} as QmlRuntime;
  resetQml(runtime);
  return runtime;
}

function startQml(
  runtime: QmlRuntime,
  sweepIndex: number,
  sweepEventIndex: number,
  sweep: LiquiditySweepSnapshot,
  candle: CompactCandle,
  activeSession: XauTradingSession,
): void {
  resetQml(runtime);
  runtime.stage = "LIQUIDITY_SWEPT";
  runtime.direction = sweep.direction;
  runtime.sweepIndex = sweepIndex;
  runtime.sweepEventIndex = sweepEventIndex;
  runtime.sweepLevelPrice = sweep.levelPrice;
  runtime.sweepLevelType = sweep.levelType;
  runtime.score = sweep.score;
  runtime.headPrice = sweep.direction === "BEARISH" ? candle[2] : candle[3];
  runtime.reasonMask = reasonMask(["IMPORTANT_LIQUIDITY_SWEPT", "LEVEL_RECLAIMED"]);
  if (isActiveExecutionSession(activeSession)) runtime.reasonMask |= REASON_BIT.get("ACTIVE_SESSION_CONTEXT") ?? 0;
}

function updateQmlRuntime(input: {
  runtime: QmlRuntime;
  candle: CompactCandle;
  candleIndex: number;
  averageRange: number;
  sweep: LiquiditySweepSnapshot | null;
  sweepEventIndex: number;
  shift: StructureShiftSnapshot | null;
  structureEventIndex: number;
  levels: readonly InternalLevel[];
  highs: readonly SwingPoint[];
  lows: readonly SwingPoint[];
  activeSession: XauTradingSession;
  location: MarketLocationZone;
  dataReady: boolean;
}): void {
  const {
    runtime,
    candle,
    candleIndex,
    averageRange,
    sweep,
    sweepEventIndex,
    shift,
    structureEventIndex,
    levels,
    highs,
    lows,
    activeSession,
    location,
    dataReady,
  } = input;

  if (runtime.stage === "INVALIDATED" || runtime.stage === "EXPIRED") {
    if (runtime.terminalStageShownAt === NONE) runtime.terminalStageShownAt = candleIndex;
    else if (candleIndex > runtime.terminalStageShownAt) resetQml(runtime);
  }
  if (runtime.stage === "RETEST_CONFIRMED" && runtime.confirmedIndex >= 0 && candleIndex - runtime.confirmedIndex > 3) {
    resetQml(runtime);
  }

  if (!dataReady) {
    if (runtime.stage !== "NONE") runtime.blockerMask |= REASON_BIT.get("DATA_NOT_READY") ?? 0;
    return;
  }

  if (sweep && sweep.score >= SESSION_LIQUIDITY_CONFIG.minimumSweepScore) {
    const replace = runtime.stage === "NONE" ||
      (runtime.direction !== sweep.direction && sweep.score >= runtime.score + 7) ||
      (runtime.direction === sweep.direction && runtime.stage === "LIQUIDITY_SWEPT" && sweep.score > runtime.score + 5);
    if (replace) startQml(runtime, candleIndex, sweepEventIndex, sweep, candle, activeSession);
  }

  if (runtime.stage === "NONE" || runtime.direction === null) return;
  const direction = runtime.direction;
  const headBroken = direction === "BEARISH"
    ? candle[4] > runtime.headPrice + averageRange * SESSION_LIQUIDITY_CONFIG.qmlHeadBufferAverageRange
    : candle[4] < runtime.headPrice - averageRange * SESSION_LIQUIDITY_CONFIG.qmlHeadBufferAverageRange;
  if (headBroken) {
    runtime.stage = "INVALIDATED";
    runtime.blockerMask |= REASON_BIT.get("HEAD_INVALIDATED") ?? 0;
    runtime.terminalStageShownAt = candleIndex;
    return;
  }

  if (runtime.stage === "LIQUIDITY_SWEPT") {
    if (candleIndex - runtime.sweepIndex > SESSION_LIQUIDITY_CONFIG.qmlMssWindowBars) {
      runtime.stage = "EXPIRED";
      runtime.blockerMask |= REASON_BIT.get("RETEST_TOO_LATE") ?? 0;
      runtime.terminalStageShownAt = candleIndex;
      return;
    }
    const structureAccepted = shift?.type === "MSS" || (shift?.type === "BOS" && shift.score >= 78 && shift.displacementScore >= 68);
    if (shift && structureAccepted && shift.direction === direction && candleIndex > runtime.sweepIndex) {
      const shoulder = previousShoulder(direction, runtime.sweepIndex, highs, lows);
      const fallbackLevel = Number.isFinite(runtime.sweepLevelPrice) ? runtime.sweepLevelPrice : null;
      const shoulderGeometryValid = shoulder !== null && (
        direction === "BEARISH"
          ? shoulder.price < runtime.headPrice
          : shoulder.price > runtime.headPrice
      );
      const shoulderDistanceValid = shoulder !== null && fallbackLevel !== null &&
        Math.abs(shoulder.price - fallbackLevel) <= Math.max(averageRange * 3.5, Math.abs(runtime.headPrice - fallbackLevel) * 2.25);
      const validShoulder = shoulderGeometryValid && (fallbackLevel === null || shoulderDistanceValid) ? shoulder : null;
      const qmlLevel = validShoulder?.price ?? fallbackLevel ?? candle[1];
      const width = Math.max(0.02, averageRange * SESSION_LIQUIDITY_CONFIG.qmlEntryZoneAverageRange);
      const target = targetForDirection(direction, levels, qmlLevel, candle[4], averageRange);
      runtime.stage = "MSS_CONFIRMED";
      runtime.mssIndex = candleIndex;
      runtime.structureEventIndex = structureEventIndex;
      runtime.shoulderPrice = validShoulder?.price ?? qmlLevel;
      runtime.qmlLevel = qmlLevel;
      runtime.entryLower = qmlLevel - width;
      runtime.entryUpper = qmlLevel + width;
      runtime.invalidationPrice = runtime.headPrice + (direction === "BEARISH" ? 1 : -1) * averageRange * SESSION_LIQUIDITY_CONFIG.qmlHeadBufferAverageRange;
      runtime.targetPrice = target.price;
      runtime.targetType = target.type;
      runtime.score = Math.min(100, runtime.score * 0.5 + shift.score * 0.5);
      runtime.reasonMask |= reasonMask(["MSS_BODY_CLOSE", "DISPLACEMENT_PRESENT", "QML_SHOULDER_IDENTIFIED"]);
      if (target.type) runtime.reasonMask |= REASON_BIT.get("OPPOSITE_LIQUIDITY_AVAILABLE") ?? 0;
      if (location === "RANGE_MIDDLE") runtime.blockerMask |= REASON_BIT.get("MID_RANGE_LOCATION") ?? 0;
      return;
    }
  }

  if (runtime.stage === "MSS_CONFIRMED") {
    runtime.stage = "RETEST_WAIT";
  }

  if (runtime.stage !== "RETEST_WAIT") return;
  if (candleIndex - runtime.mssIndex > SESSION_LIQUIDITY_CONFIG.qmlRetestWindowBars) {
    runtime.stage = "EXPIRED";
    runtime.blockerMask |= REASON_BIT.get("RETEST_TOO_LATE") ?? 0;
    runtime.terminalStageShownAt = candleIndex;
    return;
  }
  const zoneTouched = candle[2] >= runtime.entryLower && candle[3] <= runtime.entryUpper;
  if (!zoneTouched || candleIndex <= runtime.mssIndex) return;
  runtime.retestCount += 1;
  if (runtime.retestCount > SESSION_LIQUIDITY_CONFIG.qmlMaximumRetests) {
    runtime.stage = "EXPIRED";
    runtime.blockerMask |= REASON_BIT.get("RETEST_TOO_LATE") ?? 0;
    runtime.terminalStageShownAt = candleIndex;
    return;
  }

  const range = Math.max(candle[2] - candle[3], 1e-9);
  const body = Math.abs(candle[4] - candle[1]);
  const upperWick = candle[2] - Math.max(candle[1], candle[4]);
  const lowerWick = Math.min(candle[1], candle[4]) - candle[3];
  const correctClose = direction === "BEARISH"
    ? candle[4] <= runtime.qmlLevel + averageRange * 0.05
    : candle[4] >= runtime.qmlLevel - averageRange * 0.05;
  const directionCandle = direction === "BEARISH" ? candle[4] < candle[1] : candle[4] > candle[1];
  const rejection = direction === "BEARISH" ? upperWick >= body * 0.65 : lowerWick >= body * 0.65;
  if (!correctClose || (!directionCandle && !rejection)) return;

  const risk = Math.abs(runtime.qmlLevel - runtime.invalidationPrice);
  const reward = Math.abs(runtime.targetPrice - runtime.qmlLevel);
  const targetRatio = risk > 0 ? reward / risk : 0;
  const firstRetestBonus = runtime.retestCount === 1 ? 12 : 5;
  const activeBonus = isActiveExecutionSession(activeSession) ? 8 : activeSession === "ASIA" ? 4 : 0;
  const locationBonus = location === "RANGE_UPPER_EDGE" || location === "UPPER_EXTERNAL_LIQUIDITY" || location === "RANGE_LOWER_EDGE" || location === "LOWER_EXTERNAL_LIQUIDITY" || location === "ABOVE_PREVIOUS_DAY" || location === "BELOW_PREVIOUS_DAY" ? 8 : 2;
  const rejectionScore = Math.min(10, ((direction === "BEARISH" ? upperWick : lowerWick) / range) * 15);
  runtime.score = Math.min(100, runtime.score * 0.66 + firstRetestBonus + activeBonus + locationBonus + rejectionScore + Math.min(8, targetRatio * 3));
  if (runtime.score >= SESSION_LIQUIDITY_CONFIG.qmlMediumReadyScore) {
    runtime.stage = "RETEST_CONFIRMED";
    runtime.confirmedIndex = candleIndex;
    runtime.reasonMask |= REASON_BIT.get(
      runtime.retestCount === 1 ? "FIRST_RETEST_CONFIRMED" : "SECOND_RETEST_CONFIRMED",
    ) ?? 0;
  }
}

function writeNearest(
  arrays: SessionLiquidityArrays,
  index: number,
  above: InternalLevel | null,
  below: InternalLevel | null,
): void {
  if (above) {
    arrays.abovePrice[index] = above.price;
    arrays.aboveType[index] = LEVEL_TYPE_CODE.get(above.type) ?? NONE;
    arrays.aboveStrength[index] = above.strength;
    arrays.aboveFormedAt[index] = above.formedAtMs;
  }
  if (below) {
    arrays.belowPrice[index] = below.price;
    arrays.belowType[index] = LEVEL_TYPE_CODE.get(below.type) ?? NONE;
    arrays.belowStrength[index] = below.strength;
    arrays.belowFormedAt[index] = below.formedAtMs;
  }
}

function writeQml(arrays: SessionLiquidityArrays, index: number, runtime: QmlRuntime): void {
  arrays.qmlStage[index] = QML_STAGE_CODE.get(runtime.stage) ?? 0;
  arrays.qmlDirection[index] = runtime.direction === "BULLISH" ? 1 : runtime.direction === "BEARISH" ? 2 : 0;
  arrays.qmlScore[index] = Math.max(0, Math.min(100, Math.round(runtime.score)));
  arrays.qmlLevel[index] = runtime.qmlLevel;
  arrays.qmlShoulder[index] = runtime.shoulderPrice;
  arrays.qmlHead[index] = runtime.headPrice;
  arrays.qmlInvalidation[index] = runtime.invalidationPrice;
  arrays.qmlEntryLower[index] = runtime.entryLower;
  arrays.qmlEntryUpper[index] = runtime.entryUpper;
  arrays.qmlTarget[index] = runtime.targetPrice;
  arrays.qmlTargetType[index] = runtime.targetType ? LEVEL_TYPE_CODE.get(runtime.targetType) ?? NONE : NONE;
  arrays.qmlRetestCount[index] = runtime.retestCount;
  arrays.qmlSweepEvent[index] = runtime.sweepEventIndex;
  arrays.qmlStructureEvent[index] = runtime.structureEventIndex;
  arrays.qmlAgeBars[index] = runtime.sweepIndex >= 0 ? Math.min(255, index - runtime.sweepIndex) : 0;
  arrays.qmlReasonMask[index] = runtime.reasonMask;
  arrays.qmlBlockerMask[index] = runtime.blockerMask;
}

function levelSnapshotFromArrays(
  arrays: SessionLiquidityArrays,
  index: number,
  side: "ABOVE" | "BELOW",
): LiquidityLevelSnapshot | null {
  const price = side === "ABOVE" ? arrays.abovePrice[index] : arrays.belowPrice[index];
  const typeCode = side === "ABOVE" ? arrays.aboveType[index] : arrays.belowType[index];
  if (!Number.isFinite(price) || typeCode < 0) return null;
  const type = LEVEL_TYPES[typeCode];
  const formedAtMs = side === "ABOVE" ? arrays.aboveFormedAt[index] : arrays.belowFormedAt[index];
  return {
    id: `${type}:${formedAtMs}:${stable(price)}`,
    type,
    side: sideForType(type),
    price: stable(price),
    formedAtMs,
    availableAtMs: formedAtMs,
    strength: side === "ABOVE" ? arrays.aboveStrength[index] : arrays.belowStrength[index],
    touches: 1,
    freshnessBars: 0,
    obstacleClass: obstacleClassForType(type),
    status: "ACTIVE",
  };
}

function qmlSnapshot(index: SessionLiquidityIndex, candleIndex: number): QmlSetupSnapshot {
  const arrays = index.arrays;
  const stage = QML_STAGES[arrays.qmlStage[candleIndex]] ?? "NONE";
  const direction: OpportunityDirection = arrays.qmlDirection[candleIndex] === 1 ? "BULLISH" : arrays.qmlDirection[candleIndex] === 2 ? "BEARISH" : "NEUTRAL";
  const sweepIndex = arrays.qmlSweepEvent[candleIndex];
  const structureIndex = arrays.qmlStructureEvent[candleIndex];
  const targetTypeCode = arrays.qmlTargetType[candleIndex];
  return {
    timestampMs: index.datasets.M1.candles[candleIndex][0] + MINUTE_MS,
    direction,
    stage,
    score: arrays.qmlScore[candleIndex],
    sweep: sweepIndex >= 0 ? index.sweepEvents[sweepIndex] ?? null : null,
    structureShift: structureIndex >= 0 ? index.structureEvents[structureIndex] ?? null : null,
    qmlLevel: finite(arrays.qmlLevel[candleIndex]),
    shoulderPrice: finite(arrays.qmlShoulder[candleIndex]),
    headPrice: finite(arrays.qmlHead[candleIndex]),
    invalidationPrice: finite(arrays.qmlInvalidation[candleIndex]),
    entryLower: finite(arrays.qmlEntryLower[candleIndex]),
    entryUpper: finite(arrays.qmlEntryUpper[candleIndex]),
    targetPrice: finite(arrays.qmlTarget[candleIndex]),
    targetType: targetTypeCode >= 0 ? LEVEL_TYPES[targetTypeCode] : null,
    retestCount: arrays.qmlRetestCount[candleIndex],
    firstRetest: arrays.qmlRetestCount[candleIndex] === 1,
    ageBars: arrays.qmlAgeBars[candleIndex],
    reasons: decodeReasons(arrays.qmlReasonMask[candleIndex]),
    blockers: decodeReasons(arrays.qmlBlockerMask[candleIndex]),
  };
}

function reconstruct(index: SessionLiquidityIndex, candleIndex: number): SessionLiquiditySnapshot {
  const arrays = index.arrays;
  const sweepEventIndex = arrays.sweepEvent[candleIndex];
  const structureEventIndex = arrays.structureEvent[candleIndex];
  return {
    timestampMs: index.datasets.M1.candles[candleIndex][0] + MINUTE_MS,
    activeSession: SESSION_VALUES[arrays.session[candleIndex]] ?? "OFF_HOURS",
    location: LOCATION_VALUES[arrays.location[candleIndex]] ?? "UNAVAILABLE",
    previousDayHigh: finite(arrays.previousDayHigh[candleIndex]),
    previousDayLow: finite(arrays.previousDayLow[candleIndex]),
    previousWeekHigh: finite(arrays.previousWeekHigh[candleIndex]),
    previousWeekLow: finite(arrays.previousWeekLow[candleIndex]),
    asiaHigh: finite(arrays.asiaHigh[candleIndex]),
    asiaLow: finite(arrays.asiaLow[candleIndex]),
    londonHigh: finite(arrays.londonHigh[candleIndex]),
    londonLow: finite(arrays.londonLow[candleIndex]),
    newYorkHigh: finite(arrays.newYorkHigh[candleIndex]),
    newYorkLow: finite(arrays.newYorkLow[candleIndex]),
    nearestLiquidityAbove: levelSnapshotFromArrays(arrays, candleIndex, "ABOVE"),
    nearestLiquidityBelow: levelSnapshotFromArrays(arrays, candleIndex, "BELOW"),
    latestSweep: sweepEventIndex >= 0 ? index.sweepEvents[sweepEventIndex] ?? null : null,
    latestStructureShift: structureEventIndex >= 0 ? index.structureEvents[structureEventIndex] ?? null : null,
    qml: qmlSnapshot(index, candleIndex),
    dataReady: arrays.dataReady[candleIndex] === 1,
  };
}

function buildIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  dailyBoundaryMode: DailyBoundaryMode,
): SessionLiquidityIndex {
  const candles = datasets.M1.candles;
  const arrays = allocateArrays(candles.length);
  const prefixRange = new Float64Array(candles.length + 1);
  for (let index = 0; index < candles.length; index += 1) prefixRange[index + 1] = prefixRange[index] + Math.max(0, candles[index][2] - candles[index][3]);

  const trackers: Record<CoreTradingSession, SessionTracker> = {
    ASIA: { active: null, completed: null },
    LONDON: { active: null, completed: null },
    NEW_YORK: { active: null, completed: null },
  };
  const m1Highs: SwingPoint[] = [];
  const m1Lows: SwingPoint[] = [];
  const m15Highs: SwingPoint[] = [];
  const m15Lows: SwingPoint[] = [];
  const h1Highs: SwingPoint[] = [];
  const h1Lows: SwingPoint[] = [];
  const brokenSwingIds = new Set<string>();
  const lastSweepByLevel = new Map<string, number>();
  const sweepEvents: LiquiditySweepSnapshot[] = [];
  const structureEvents: StructureShiftSnapshot[] = [];
  const qml = newQmlRuntime();
  const closedDays: CompactCandle[] = [];
  let d1Pointer = 0;
  let lastM15ClosedProcessed = NONE;
  let lastH1ClosedProcessed = NONE;
  let d1TotalClosed = 0;
  let d1UsableClosed = 0;
  let h1TotalClosed = 0;
  let h1UsableClosed = 0;
  let d1RejectedByCoverage = 0;
  let h1RejectedByCoverage = 0;
  const emptyCoverageBreakdown = () => ({ complete: 0, expectedMarketClosure: 0, boundaryAndClosure: 0, partialUsable: 0, partialRejected: 0, missingData: 0, overfull: 0 });
  const d1Coverage = emptyCoverageBreakdown();
  const h1Coverage = emptyCoverageBreakdown();
  const recordCoverage = (dataset: TimeframeDataset, index: number, target: ReturnType<typeof emptyCoverageBreakdown>) => {
    const coverage = dataset.completeness[index];
    if (!coverage) { target.missingData += 1; return; }
    if (coverage.status === "COMPLETE") target.complete += 1;
    else if (coverage.status === "EXPECTED_MARKET_CLOSURE") target.expectedMarketClosure += 1;
    else if (coverage.status === "BOUNDARY_AND_CLOSURE") target.boundaryAndClosure += 1;
    else if (coverage.status === "MISSING_DATA") target.missingData += 1;
    else if (coverage.status === "OVERFULL") target.overfull += 1;
    else if (coverage.completenessPercent >= 97) target.partialUsable += 1;
    else target.partialRejected += 1;
  };
  let lastFailureReasons: string[] = ["D1_WARMUP_NOT_READY", "H1_WARMUP_NOT_READY"];

  const sessionCounts = countRecord(SESSION_VALUES);
  const locationCounts = countRecord(LOCATION_VALUES);
  const strongest = new FixedMinHeap<QmlSetupSnapshot>(SESSION_LIQUIDITY_CONFIG.strongestQmlLimit, (item) => item.score);
  let dataReadySamples = 0;
  let sweepCount = 0;
  let bullishSweepCount = 0;
  let bearishSweepCount = 0;
  let bosCount = 0;
  let mssCount = 0;
  let qmlWatchCount = 0;
  let qmlMssCount = 0;
  let qmlRetestConfirmedCount = 0;
  let qmlInvalidatedCount = 0;
  let qmlExpiredCount = 0;
  let qmlGradeReadyCount = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const closeTimestampMs = candle[0] + MINUTE_MS;
    const averageRange = Math.max(0.01, averagePriorRange(prefixRange, index));
    updateSessionTrackers(trackers, candle);

    while (d1Pointer < datasets.D1.candles.length) {
      const d1 = datasets.D1.candles[d1Pointer];
      const closeMs = getNextDailyBucketStart(d1[0], dailyBoundaryMode);
      if (closeMs > closeTimestampMs) break;
      d1TotalClosed += 1;
      recordCoverage(datasets.D1, d1Pointer, d1Coverage);
      if (contextUsable(datasets.D1, d1Pointer)) {
        closedDays.push(d1);
        d1UsableClosed += 1;
      } else {
        d1RejectedByCoverage += 1;
      }
      d1Pointer += 1;
    }
    const previousDay = closedDays.at(-1) ?? null;
    const previousWeek = previousCompletedTradingWeek(closedDays, candle[0], dailyBoundaryMode);
    const previousWeekHigh = previousWeek?.high ?? null;
    const previousWeekLow = previousWeek?.low ?? null;
    const previousDayHigh = previousDay?.[2] ?? null;
    const previousDayLow = previousDay?.[3] ?? null;

    const m15Closed = closedIndexAtOrBefore(datasets.M15, 15 * MINUTE_MS, closeTimestampMs);
    while (lastM15ClosedProcessed < m15Closed) {
      lastM15ClosedProcessed += 1;
      const pivotIndex = lastM15ClosedProcessed - SESSION_LIQUIDITY_CONFIG.pivotRadius;
      if (isPivot(datasets.M15, pivotIndex, "HIGH")) m15Highs.push({ index: pivotIndex, timestampMs: datasets.M15.candles[pivotIndex][0] + 15 * MINUTE_MS, price: datasets.M15.candles[pivotIndex][2], side: "HIGH", timeframe: "M15" });
      if (isPivot(datasets.M15, pivotIndex, "LOW")) m15Lows.push({ index: pivotIndex, timestampMs: datasets.M15.candles[pivotIndex][0] + 15 * MINUTE_MS, price: datasets.M15.candles[pivotIndex][3], side: "LOW", timeframe: "M15" });
    }
    const h1Closed = closedIndexAtOrBefore(datasets.H1, 60 * MINUTE_MS, closeTimestampMs);
    while (lastH1ClosedProcessed < h1Closed) {
      lastH1ClosedProcessed += 1;
      h1TotalClosed += 1;
      recordCoverage(datasets.H1, lastH1ClosedProcessed, h1Coverage);
      if (contextUsable(datasets.H1, lastH1ClosedProcessed)) h1UsableClosed += 1;
      else h1RejectedByCoverage += 1;
      const pivotIndex = lastH1ClosedProcessed - SESSION_LIQUIDITY_CONFIG.pivotRadius;
      if (isPivot(datasets.H1, pivotIndex, "HIGH")) h1Highs.push({ index: pivotIndex, timestampMs: datasets.H1.candles[pivotIndex][0] + 60 * MINUTE_MS, price: datasets.H1.candles[pivotIndex][2], side: "HIGH", timeframe: "H1" });
      if (isPivot(datasets.H1, pivotIndex, "LOW")) h1Lows.push({ index: pivotIndex, timestampMs: datasets.H1.candles[pivotIndex][0] + 60 * MINUTE_MS, price: datasets.H1.candles[pivotIndex][3], side: "LOW", timeframe: "H1" });
    }

    const m1Pivot = index - SESSION_LIQUIDITY_CONFIG.pivotRadius;
    if (isPivot(datasets.M1, m1Pivot, "HIGH")) m1Highs.push({ index: m1Pivot, timestampMs: datasets.M1.candles[m1Pivot][0] + MINUTE_MS, price: datasets.M1.candles[m1Pivot][2], side: "HIGH", timeframe: "M1" });
    if (isPivot(datasets.M1, m1Pivot, "LOW")) m1Lows.push({ index: m1Pivot, timestampMs: datasets.M1.candles[m1Pivot][0] + MINUTE_MS, price: datasets.M1.candles[m1Pivot][3], side: "LOW", timeframe: "M1" });

    const levels: InternalLevel[] = [];
    addLevel(levels, level("PREVIOUS_DAY_HIGH", previousDayHigh, previousDay?.[0] ?? 0, previousDay ? getNextDailyBucketStart(previousDay[0], dailyBoundaryMode) : 0));
    addLevel(levels, level("PREVIOUS_DAY_LOW", previousDayLow, previousDay?.[0] ?? 0, previousDay ? getNextDailyBucketStart(previousDay[0], dailyBoundaryMode) : 0));
    addLevel(levels, level("PREVIOUS_WEEK_HIGH", previousWeekHigh, previousWeek?.formedAtMs ?? 0, previousWeek?.availableAtMs ?? 0));
    addLevel(levels, level("PREVIOUS_WEEK_LOW", previousWeekLow, previousWeek?.formedAtMs ?? 0, previousWeek?.availableAtMs ?? 0));
    addLevel(levels, rangeLevel(trackers.ASIA.completed, "ASIA", "HIGH"));
    addLevel(levels, rangeLevel(trackers.ASIA.completed, "ASIA", "LOW"));
    addLevel(levels, rangeLevel(trackers.LONDON.completed, "LONDON", "HIGH"));
    addLevel(levels, rangeLevel(trackers.LONDON.completed, "LONDON", "LOW"));
    addLevel(levels, rangeLevel(trackers.NEW_YORK.completed, "NEW_YORK", "HIGH"));
    addLevel(levels, rangeLevel(trackers.NEW_YORK.completed, "NEW_YORK", "LOW"));
    addLevel(levels, recentSwingLevel(m15Highs, "M15_SWING_HIGH", index));
    addLevel(levels, recentSwingLevel(m15Lows, "M15_SWING_LOW", index));
    addLevel(levels, recentSwingLevel(h1Highs, "H1_SWING_HIGH", index));
    addLevel(levels, recentSwingLevel(h1Lows, "H1_SWING_LOW", index));

    const recentM15High = m15Highs.at(-1);
    const previousM15High = m15Highs.at(-2);
    if (recentM15High && previousM15High && Math.abs(recentM15High.price - previousM15High.price) <= averageRange * 0.2) {
      addLevel(levels, level("EQUAL_HIGHS", (recentM15High.price + previousM15High.price) / 2, previousM15High.timestampMs, recentM15High.timestampMs, 2));
    }
    const recentM15Low = m15Lows.at(-1);
    const previousM15Low = m15Lows.at(-2);
    if (recentM15Low && previousM15Low && Math.abs(recentM15Low.price - previousM15Low.price) <= averageRange * 0.2) {
      addLevel(levels, level("EQUAL_LOWS", (recentM15Low.price + previousM15Low.price) / 2, previousM15Low.timestampMs, recentM15Low.timestampMs, 2));
    }

    const activeSession = classifyXauTradingSession(candle[0]);
    const location = marketLocation(candle[4], previousDayHigh, previousDayLow);
    const dataReady = d1UsableClosed >= SESSION_LIQUIDITY_CONFIG.minimumWarmupD1 && h1UsableClosed >= SESSION_LIQUIDITY_CONFIG.minimumWarmupH1;
    lastFailureReasons = [];
    if (d1UsableClosed < SESSION_LIQUIDITY_CONFIG.minimumWarmupD1) lastFailureReasons.push("D1_USABLE_WARMUP_BELOW_MINIMUM");
    if (h1UsableClosed < SESSION_LIQUIDITY_CONFIG.minimumWarmupH1) lastFailureReasons.push("H1_USABLE_WARMUP_BELOW_MINIMUM");
    const nearest = nearestLevels(levels, candle[4]);
    const sweep = dataReady ? bestSweep(levels, candle, index, averageRange, activeSession, lastSweepByLevel) : null;
    let sweepEventIndex = NONE;
    if (sweep) {
      sweepEventIndex = sweepEvents.length;
      sweepEvents.push(sweep);
      sweepCount += 1;
      if (sweep.direction === "BULLISH") bullishSweepCount += 1;
      else bearishSweepCount += 1;
    }
    const shift = dataReady ? detectStructureShift(candles, index, averageRange, m1Highs, m1Lows, brokenSwingIds) : null;
    let structureEventIndex = NONE;
    if (shift) {
      structureEventIndex = structureEvents.length;
      structureEvents.push(shift);
      if (shift.type === "MSS") mssCount += 1;
      else bosCount += 1;
    }

    const previousQmlStage = qml.stage;
    updateQmlRuntime({
      runtime: qml,
      candle,
      candleIndex: index,
      averageRange,
      sweep,
      sweepEventIndex,
      shift,
      structureEventIndex,
      levels,
      highs: m1Highs,
      lows: m1Lows,
      activeSession,
      location,
      dataReady,
    });

    arrays.session[index] = SESSION_CODE.get(activeSession) ?? 4;
    arrays.location[index] = LOCATION_CODE.get(location) ?? 7;
    arrays.dataReady[index] = dataReady ? 1 : 0;
    arrays.previousDayHigh[index] = previousDayHigh ?? Number.NaN;
    arrays.previousDayLow[index] = previousDayLow ?? Number.NaN;
    arrays.previousWeekHigh[index] = previousWeekHigh ?? Number.NaN;
    arrays.previousWeekLow[index] = previousWeekLow ?? Number.NaN;
    arrays.asiaHigh[index] = trackers.ASIA.completed?.high ?? Number.NaN;
    arrays.asiaLow[index] = trackers.ASIA.completed?.low ?? Number.NaN;
    arrays.londonHigh[index] = trackers.LONDON.completed?.high ?? Number.NaN;
    arrays.londonLow[index] = trackers.LONDON.completed?.low ?? Number.NaN;
    arrays.newYorkHigh[index] = trackers.NEW_YORK.completed?.high ?? Number.NaN;
    arrays.newYorkLow[index] = trackers.NEW_YORK.completed?.low ?? Number.NaN;
    writeNearest(arrays, index, nearest.above, nearest.below);
    arrays.sweepEvent[index] = sweepEventIndex;
    arrays.structureEvent[index] = structureEventIndex;
    writeQml(arrays, index, qml);

    sessionCounts[activeSession] += 1;
    locationCounts[location] += 1;
    if (dataReady) dataReadySamples += 1;
    if (qml.stage !== previousQmlStage) {
      if (qml.stage === "LIQUIDITY_SWEPT") qmlWatchCount += 1;
      if (qml.stage === "MSS_CONFIRMED" || (qml.stage === "RETEST_WAIT" && previousQmlStage !== "MSS_CONFIRMED")) qmlMssCount += 1;
      if (qml.stage === "RETEST_CONFIRMED") {
        qmlRetestConfirmedCount += 1;
        qmlGradeReadyCount += 1;
      }
      if (qml.stage === "INVALIDATED") qmlInvalidatedCount += 1;
      if (qml.stage === "EXPIRED") qmlExpiredCount += 1;
    }
  }

  const placeholder: SessionLiquidityIndex = {
    datasets,
    dailyBoundaryMode,
    arrays,
    sweepEvents,
    structureEvents,
    summary: {} as SessionLiquiditySummary,
    latest: null,
  };
  for (let index = 0; index < candles.length; index += 1) {
    const stage = QML_STAGES[arrays.qmlStage[index]] ?? "NONE";
    const previousStage = index > 0 ? QML_STAGES[arrays.qmlStage[index - 1]] ?? "NONE" : "NONE";
    if (stage === "RETEST_CONFIRMED" && previousStage !== "RETEST_CONFIRMED") {
      strongest.push(qmlSnapshot(placeholder, index));
    }
  }
  placeholder.summary = {
    sampleCount: candles.length,
    dataReadySamples,
    sweepCount,
    bullishSweepCount,
    bearishSweepCount,
    bosCount,
    mssCount,
    qmlWatchCount,
    qmlMssCount,
    qmlRetestConfirmedCount,
    qmlInvalidatedCount,
    qmlExpiredCount,
    qmlGradeReadyCount,
    sessionCounts,
    locationCounts,
    strongestQmlSetups: strongest.toDescendingArray(),
    readiness: {
      d1TotalClosed,
      d1UsableClosed,
      h1TotalClosed,
      h1UsableClosed,
      minimumRequiredD1: SESSION_LIQUIDITY_CONFIG.minimumWarmupD1,
      minimumRequiredH1: SESSION_LIQUIDITY_CONFIG.minimumWarmupH1,
      d1RejectedByCoverage,
      h1RejectedByCoverage,
      d1Coverage,
      h1Coverage,
      lastFailureReasons,
    },
  };
  placeholder.latest = candles.length > 0 ? reconstruct(placeholder, candles.length - 1) : null;
  return placeholder;
}

export function createSessionLiquidityIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  dailyBoundaryMode: DailyBoundaryMode,
): SessionLiquidityIndex {
  return buildIndex(datasets, dailyBoundaryMode);
}

export function getOrCreateSessionLiquidityIndex(
  datasets: Record<Timeframe, TimeframeDataset>,
  dailyBoundaryMode: DailyBoundaryMode,
): SessionLiquidityIndex {
  const existing = cache.get(datasets);
  if (existing && existing.dailyBoundaryMode === dailyBoundaryMode) return existing;
  const created = createSessionLiquidityIndex(datasets, dailyBoundaryMode);
  cache.set(datasets, created);
  return created;
}

export function sessionLiquidityAtIndex(
  index: SessionLiquidityIndex,
  candleIndex: number,
): SessionLiquiditySnapshot | null {
  if (candleIndex < 0 || candleIndex >= index.datasets.M1.candles.length) return null;
  return reconstruct(index, candleIndex);
}

export function analyzeSessionLiquidityAt(
  index: SessionLiquidityIndex,
  anchorTimestampMs: number,
): SessionLiquiditySnapshot | null {
  const candles = index.datasets.M1.candles;
  let low = 0;
  let high = candles.length - 1;
  let answer = NONE;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (candles[middle][0] + MINUTE_MS <= anchorTimestampMs) {
      answer = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return answer >= 0 ? reconstruct(index, answer) : null;
}

export function summarizeSessionLiquidityRange(
  index: SessionLiquidityIndex,
  fromTimestampMs: number,
  toTimestampMs: number,
): SessionLiquiditySummary {
  const sessionCounts = countRecord(SESSION_VALUES);
  const locationCounts = countRecord(LOCATION_VALUES);
  const strongest = new FixedMinHeap<QmlSetupSnapshot>(SESSION_LIQUIDITY_CONFIG.strongestQmlLimit, (item) => item.score);
  let sampleCount = 0;
  let dataReadySamples = 0;
  let sweepCount = 0;
  let bullishSweepCount = 0;
  let bearishSweepCount = 0;
  let bosCount = 0;
  let mssCount = 0;
  let qmlWatchCount = 0;
  let qmlMssCount = 0;
  let qmlRetestConfirmedCount = 0;
  let qmlInvalidatedCount = 0;
  let qmlExpiredCount = 0;
  let qmlGradeReadyCount = 0;
  const candles = index.datasets.M1.candles;
  for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
    const timestampMs = candles[candleIndex][0] + MINUTE_MS;
    if (timestampMs < fromTimestampMs || timestampMs >= toTimestampMs) continue;
    sampleCount += 1;
    const session = SESSION_VALUES[index.arrays.session[candleIndex]] ?? "OFF_HOURS";
    const location = LOCATION_VALUES[index.arrays.location[candleIndex]] ?? "UNAVAILABLE";
    sessionCounts[session] += 1;
    locationCounts[location] += 1;
    if (index.arrays.dataReady[candleIndex] === 1) dataReadySamples += 1;
    const sweep = index.arrays.sweepEvent[candleIndex];
    if (sweep >= 0) {
      sweepCount += 1;
      if (index.sweepEvents[sweep]?.direction === "BULLISH") bullishSweepCount += 1;
      else bearishSweepCount += 1;
    }
    const structure = index.arrays.structureEvent[candleIndex];
    if (structure >= 0) {
      if (index.structureEvents[structure]?.type === "MSS") mssCount += 1;
      else bosCount += 1;
    }
    const stage = QML_STAGES[index.arrays.qmlStage[candleIndex]] ?? "NONE";
    const previousStage = candleIndex > 0
      ? QML_STAGES[index.arrays.qmlStage[candleIndex - 1]] ?? "NONE"
      : "NONE";
    const transitioned = stage !== previousStage;
    if (transitioned && stage === "LIQUIDITY_SWEPT") qmlWatchCount += 1;
    if (transitioned && stage === "MSS_CONFIRMED") qmlMssCount += 1;
    if (transitioned && stage === "RETEST_CONFIRMED") {
      qmlRetestConfirmedCount += 1;
      qmlGradeReadyCount += 1;
      strongest.push(qmlSnapshot(index, candleIndex));
    }
    if (transitioned && stage === "INVALIDATED") qmlInvalidatedCount += 1;
    if (transitioned && stage === "EXPIRED") qmlExpiredCount += 1;
  }
  return {
    sampleCount,
    dataReadySamples,
    sweepCount,
    bullishSweepCount,
    bearishSweepCount,
    bosCount,
    mssCount,
    qmlWatchCount,
    qmlMssCount,
    qmlRetestConfirmedCount,
    qmlInvalidatedCount,
    qmlExpiredCount,
    qmlGradeReadyCount,
    sessionCounts,
    locationCounts,
    strongestQmlSetups: strongest.toDescendingArray(),
    readiness: index.summary.readiness,
  };
}
