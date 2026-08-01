import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  analyzeHypothesesAndOpportunitiesAt,
  createHypothesisOpportunityIndex,
  evaluateHypothesesAndOpportunities,
  summarizeHypothesesAndOpportunities,
} from "../src/lib/market/hypothesis-opportunity";
import type {
  CandleCompleteness,
  CompactCandle,
  MultiTimeframeStateSnapshot,
  PriceBehaviour,
  Timeframe,
  TimeframeDataset,
} from "../src/lib/market/types";

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 5);

function feature(overrides: Partial<PriceBehaviour> = {}): PriceBehaviour {
  return {
    timestampMs: START,
    netProgress3: 0.4, netProgress5: 0.7, netProgress10: 1.1, netProgress20: 1.5,
    grossTravel5: 0.9, grossTravel20: 2.2,
    efficiency3: 0.75, efficiency5: 0.72, efficiency10: 0.66, efficiency20: 0.61,
    speed3: 0.13, speed5: 0.14, speed10: 0.11, speed20: 0.075,
    averageOverlap5: 0.2, alternationRate5: 0.1, noiseScore: 18, rangeRegimeRatio: 1.2,
    phase: "BULLISH_IMPULSE", impulseDirection: "BULLISH", impulseStrength: 78, impulseBars: 4,
    pullbackDepthPercent: null, pullbackBars: 0, recoverySpeedRatio: null,
    breakState: "NONE", breakLevel: null, breakLookback: 0, breakAgeBars: 0,
    momentumCondition: "ACCELERATING_BULLISH", accelerationRatio: 1.5,
    extensionVsAverageRange20: 1.2, freshnessScore: 80, lateEntryRisk: "LOW",
    ...overrides,
  };
}

function snapshot(overrides: Partial<MultiTimeframeStateSnapshot> = {}): MultiTimeframeStateSnapshot {
  const value: MultiTimeframeStateSnapshot = {
    timestampMs: START + MINUTE,
    daily: { sourceTimestampMs: START - 1440 * MINUTE, availability: "AVAILABLE", condition: "BULLISH_TREND", direction: "BULLISH", strength: 72, rangePositionPercent: 60, volatilityRatio: 1.1, maturity: "DEVELOPING" },
    rolling5h: { fromTimestampMs: START - 299 * MINUTE, toTimestampMs: START + MINUTE, availability: "AVAILABLE", stage: "BULLISH_IMPULSE", direction: "BULLISH", strength: 75, efficiency: 0.68, rangePositionPercent: 70, recentProgressRatio: 1.3, candlesPresent: 300 },
    hourly: { sourceTimestampMs: START - 60 * MINUTE, availability: "AVAILABLE", zone: "UPPER_QUARTILE", condition: "WITH_TREND_PULLBACK", direction: "BULLISH", rangePositionPercent: 68, distanceToUpperInAverageRanges: 1.8, distanceToLowerInAverageRanges: 3.1, locationQuality: 72 },
    m15: { sourceTimestampMs: START - 15 * MINUTE, availability: "AVAILABLE", state: "BULLISH_PRESSURE", direction: "BULLISH", strength: 76, pressureScore: 75 },
    m5: { sourceTimestampMs: START - 5 * MINUTE, availability: "AVAILABLE", state: "BULLISH_PRESSURE", direction: "BULLISH", constructionScore: 76, freshnessScore: 72, lateEntryRisk: "LOW" },
    m1: { sourceTimestampMs: START, state: "BULLISH_IGNITION", direction: "BULLISH", quality: "CLEAN", intensity: 82, freshnessScore: 80, lateEntryRisk: "LOW" },
    composite: { direction: "BULLISH", alignment: "FRESH_ALIGNMENT", state: "TREND_CONTINUATION", evidenceScore: 76, agreementCount: 6, conflictCount: 0, availableLayers: 6 },
  };
  return { ...value, ...overrides };
}

const bullish = evaluateHypothesesAndOpportunities(snapshot(), feature());
assert.equal(bullish.leadingHypothesis, "BULLISH");
assert.equal(bullish.hypotheses.find((item) => item.direction === "BULLISH")?.state, "LEADING");

const rangeSnapshot = snapshot({
  daily: { ...snapshot().daily, condition: "RANGE", direction: "NEUTRAL", strength: 35 },
  rolling5h: { ...snapshot().rolling5h, stage: "BALANCE", direction: "NEUTRAL", strength: 35 },
  hourly: { ...snapshot().hourly, zone: "MID_RANGE", condition: "RANGE_LOCATION", direction: "NEUTRAL" },
  m15: { ...snapshot().m15, state: "COMPRESSION", direction: "NEUTRAL" },
  m5: { ...snapshot().m5, state: "COMPRESSION_BUILDING", direction: "NEUTRAL" },
  m1: { ...snapshot().m1, state: "CALM", direction: "NEUTRAL", quality: "MIXED" },
  composite: { ...snapshot().composite, direction: "NEUTRAL", alignment: "NEUTRAL", state: "RANGE", evidenceScore: 48 },
});
const rangeResult = evaluateHypothesesAndOpportunities(rangeSnapshot, feature({
  phase: "COMPRESSION",
  impulseDirection: "NEUTRAL",
  momentumCondition: "NEUTRAL",
  breakState: "NONE",
  noiseScore: 38,
}));
assert.equal(rangeResult.leadingHypothesis, "RANGE");

const pressure = evaluateHypothesesAndOpportunities(snapshot({
  m15: { ...snapshot().m15, state: "COMPRESSION", direction: "NEUTRAL" },
  m5: { ...snapshot().m5, state: "BULLISH_ACCEPTANCE" },
  m1: { ...snapshot().m1, state: "BULLISH_BREAK_ACCEPTED" },
  composite: { ...snapshot().composite, state: "COMPRESSION" },
}), feature({ breakState: "BULLISH_ACCEPTED" }));
assert.equal(pressure.opportunities.find((item) => item.family === "PRESSURE_RELEASE")?.stage, "MATURE_CANDIDATE");

const failed = evaluateHypothesesAndOpportunities(snapshot({
  hourly: { ...snapshot().hourly, zone: "ABOVE_RANGE", condition: "BREAKOUT_LOCATION" },
  m1: { ...snapshot().m1, state: "FAILED_BREAK", direction: "BEARISH" },
}), feature({ breakState: "BULLISH_FAILED", phase: "BEARISH_RECOVERY", impulseDirection: "BEARISH", momentumCondition: "ACCELERATING_BEARISH" }));
assert.equal(failed.opportunities.find((item) => item.family === "FAILED_BREAK_REVERSAL")?.direction, "BEARISH");
const reload = evaluateHypothesesAndOpportunities(snapshot({
  m5: { ...snapshot().m5, state: "BULLISH_RECOVERY" },
  m1: { ...snapshot().m1, state: "BULLISH_CONTINUATION" },
  composite: { ...snapshot().composite, state: "CORRECTION" },
}), feature({
  phase: "BULLISH_PULLBACK",
  pullbackDepthPercent: 32,
  pullbackBars: 4,
  recoverySpeedRatio: 1.45,
}));
assert((reload.opportunities.find((item) => item.family === "IMPULSE_RELOAD")?.score ?? 0) > 60);

const rotation = evaluateHypothesesAndOpportunities(snapshot({
  m15: { ...snapshot().m15, state: "ROTATION", direction: "NEUTRAL" },
  m5: { ...snapshot().m5, state: "BULLISH_RECOVERY" },
  m1: { ...snapshot().m1, state: "BULLISH_IGNITION" },
  composite: { ...snapshot().composite, alignment: "PRODUCTIVE_DISAGREEMENT", state: "ROTATION" },
}), feature());
assert.equal(rotation.opportunities.find((item) => item.family === "TIMEFRAME_ROTATION")?.stage, "MATURE_CANDIDATE");

const degraded = evaluateHypothesesAndOpportunities(snapshot({
  m15: { ...snapshot().m15, availability: "PARTIAL", state: "COMPRESSION", direction: "NEUTRAL" },
  m5: { ...snapshot().m5, availability: "PARTIAL", state: "BULLISH_ACCEPTANCE" },
  m1: { ...snapshot().m1, state: "BULLISH_BREAK_ACCEPTED", quality: "NOISY" },
  composite: { ...snapshot().composite, state: "NOISE", availableLayers: 3 },
}), feature({ breakState: "BULLISH_ACCEPTED", noiseScore: 90 }));
assert.equal(degraded.opportunities.some((item) => item.stage === "MATURE_CANDIDATE"), false);
assert.equal(degraded.opportunities.some((item) => item.stage === "DEGRADED"), true);

function complete(count: number, expected: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({ actualChildren: expected, expectedChildren: expected, fullIntervalChildren: expected, expectedClosedChildren: 0, completenessPercent: 100, status: "COMPLETE" as const }));
}
function generateM1(count: number): CompactCandle[] {
  const output: CompactCandle[] = new Array(count);
  let price = 2500;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const cycle = index % 900;
    price += cycle < 540 ? 0.008 : cycle < 700 ? -0.004 : 0.006;
    output[index] = [START + index * MINUTE, open, Math.max(open, price) + 0.035, Math.min(open, price) - 0.035, price, 1];
  }
  return output;
}
function aggregate(candles: readonly CompactCandle[], size: number): CompactCandle[] {
  const output: CompactCandle[] = [];
  for (let offset = 0; offset < candles.length; offset += size) {
    const end = Math.min(candles.length, offset + size);
    let high = -Infinity; let low = Infinity; let volume = 0;
    for (let index = offset; index < end; index += 1) {
      high = Math.max(high, candles[index][2]); low = Math.min(low, candles[index][3]); volume += candles[index][5];
    }
    output.push([candles[offset][0], candles[offset][1], high, low, candles[end - 1][4], volume]);
  }
  return output;
}
function datasetsFrom(m1: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const M5 = aggregate(m1, 5); const M15 = aggregate(m1, 15); const H1 = aggregate(m1, 60); const D1 = aggregate(m1, 1440);
  return {
    M1: { candles: m1, completeness: complete(m1.length, 1) },
    M5: { candles: M5, completeness: complete(M5.length, 5) },
    M15: { candles: M15, completeness: complete(M15.length, 15) },
    H1: { candles: H1, completeness: complete(H1.length, 60) },
    D1: { candles: D1, completeness: complete(D1.length, 1440) },
  };
}

const datasets = datasetsFrom(generateM1(100_000));
const beforeHeap = process.memoryUsage().heapUsed;
const started = performance.now();
const index = createHypothesisOpportunityIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
const result = summarizeHypothesesAndOpportunities(index);
const duration = performance.now() - started;
const heapDelta = process.memoryUsage().heapUsed - beforeHeap;
assert.equal(result.summary.sampleCount, 100_000);
assert(result.latest);
assert(result.summary.strongestOpportunities.length <= 24);

const anchor = START + 60_000 * MINUTE;
const fullAtAnchor = analyzeHypothesesAndOpportunitiesAt(index, anchor);
const prefix = datasetsFrom(datasets.M1.candles.slice(0, 60_000));
const prefixAtAnchor = analyzeHypothesesAndOpportunitiesAt(
  createHypothesisOpportunityIndex(prefix, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
  anchor,
);
assert.deepEqual(fullAtAnchor, prefixAtAnchor, "future candles changed a prior Phase 5 result");

console.table({
  samples: result.summary.sampleCount,
  matureCandidates: result.summary.matureCandidateCount,
  averageLeadingScore: result.summary.averageLeadingHypothesisScore,
  phase5Ms: Number(duration.toFixed(2)),
  heapDeltaMb: Number((heapDelta / 1024 / 1024).toFixed(2)),
  latestHypothesis: result.latest?.leadingHypothesis,
  latestAvailability: result.latest?.opportunityAvailability,
});
console.log("Phase 5 verification passed.");
