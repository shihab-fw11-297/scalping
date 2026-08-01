import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  analyzeSignalDecisionAt,
  createSignalDecisionHistory,
  createSignalDecisionIndex,
  simulateSignalDecisionSequence,
} from "../src/lib/market/signal-decision";
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

function feature(timestampMs: number, overrides: Partial<PriceBehaviour> = {}): PriceBehaviour {
  return {
    timestampMs,
    netProgress3: 0.4,
    netProgress5: 0.7,
    netProgress10: 1.1,
    netProgress20: 1.5,
    grossTravel5: 0.9,
    grossTravel20: 2.2,
    efficiency3: 0.75,
    efficiency5: 0.72,
    efficiency10: 0.66,
    efficiency20: 0.61,
    speed3: 0.13,
    speed5: 0.14,
    speed10: 0.11,
    speed20: 0.075,
    averageOverlap5: 0.2,
    alternationRate5: 0.1,
    noiseScore: 18,
    rangeRegimeRatio: 1.2,
    phase: "BULLISH_IMPULSE",
    impulseDirection: "BULLISH",
    impulseStrength: 78,
    impulseBars: 4,
    pullbackDepthPercent: null,
    pullbackBars: 0,
    recoverySpeedRatio: null,
    breakState: "NONE",
    breakLevel: null,
    breakLookback: 0,
    breakAgeBars: 0,
    momentumCondition: "ACCELERATING_BULLISH",
    accelerationRatio: 1.5,
    extensionVsAverageRange20: 1.2,
    freshnessScore: 80,
    lateEntryRisk: "LOW",
    ...overrides,
  };
}

function snapshot(timestampMs: number, overrides: Partial<MultiTimeframeStateSnapshot> = {}): MultiTimeframeStateSnapshot {
  const value: MultiTimeframeStateSnapshot = {
    timestampMs,
    daily: {
      sourceTimestampMs: timestampMs - 1440 * MINUTE,
      availability: "AVAILABLE",
      condition: "BULLISH_TREND",
      direction: "BULLISH",
      strength: 72,
      rangePositionPercent: 60,
      volatilityRatio: 1.1,
      maturity: "DEVELOPING",
    },
    rolling5h: {
      fromTimestampMs: timestampMs - 300 * MINUTE,
      toTimestampMs: timestampMs,
      availability: "AVAILABLE",
      stage: "BULLISH_IMPULSE",
      direction: "BULLISH",
      strength: 75,
      efficiency: 0.68,
      rangePositionPercent: 70,
      recentProgressRatio: 1.3,
      candlesPresent: 300,
    },
    hourly: {
      sourceTimestampMs: timestampMs - 60 * MINUTE,
      availability: "AVAILABLE",
      zone: "UPPER_QUARTILE",
      condition: "WITH_TREND_PULLBACK",
      direction: "BULLISH",
      rangePositionPercent: 68,
      distanceToUpperInAverageRanges: 1.8,
      distanceToLowerInAverageRanges: 3.1,
      locationQuality: 72,
    },
    m15: {
      sourceTimestampMs: timestampMs - 15 * MINUTE,
      availability: "AVAILABLE",
      state: "BULLISH_PRESSURE",
      direction: "BULLISH",
      strength: 76,
      pressureScore: 75,
    },
    m5: {
      sourceTimestampMs: timestampMs - 5 * MINUTE,
      availability: "AVAILABLE",
      state: "BULLISH_PRESSURE",
      direction: "BULLISH",
      constructionScore: 76,
      freshnessScore: 72,
      lateEntryRisk: "LOW",
    },
    m1: {
      sourceTimestampMs: timestampMs - MINUTE,
      state: "BULLISH_IGNITION",
      direction: "BULLISH",
      quality: "CLEAN",
      intensity: 82,
      freshnessScore: 80,
      lateEntryRisk: "LOW",
    },
    composite: {
      direction: "BULLISH",
      alignment: "FRESH_ALIGNMENT",
      state: "TREND_CONTINUATION",
      evidenceScore: 76,
      agreementCount: 6,
      conflictCount: 0,
      availableLayers: 6,
    },
  };
  return { ...value, ...overrides };
}

function track(step: ReturnType<typeof simulateSignalDecisionSequence>[number], family: string) {
  const value = step.tracks.find((item) => item.family === family);
  if (!value) throw new Error(`missing ${family} track`);
  return value;
}

const samples = [
  {
    state: snapshot(START + MINUTE, {
      m15: { ...snapshot(START + MINUTE).m15, state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...snapshot(START + MINUTE).m5, state: "BULLISH_BREAK_ATTEMPT" },
      m1: { ...snapshot(START + MINUTE).m1, state: "BULLISH_BREAK_ATTEMPT" },
      composite: { ...snapshot(START + MINUTE).composite, state: "COMPRESSION" },
    }),
    feature: feature(START, { phase: "COMPRESSION", breakState: "BULLISH_ATTEMPT" }),
    referencePrice: 2500,
  },
  {
    state: snapshot(START + 2 * MINUTE, {
      m15: { ...snapshot(START + 2 * MINUTE).m15, state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...snapshot(START + 2 * MINUTE).m5, state: "BULLISH_ACCEPTANCE" },
      m1: { ...snapshot(START + 2 * MINUTE).m1, state: "BULLISH_BREAK_ACCEPTED" },
      composite: { ...snapshot(START + 2 * MINUTE).composite, state: "COMPRESSION" },
    }),
    feature: feature(START + MINUTE, { breakState: "BULLISH_ACCEPTED" }),
    referencePrice: 2501,
  },
  {
    state: snapshot(START + 3 * MINUTE, {
      m15: { ...snapshot(START + 3 * MINUTE).m15, state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...snapshot(START + 3 * MINUTE).m5, state: "BULLISH_ACCEPTANCE" },
      m1: { ...snapshot(START + 3 * MINUTE).m1, state: "BULLISH_BREAK_ACCEPTED" },
      composite: { ...snapshot(START + 3 * MINUTE).composite, state: "COMPRESSION" },
    }),
    feature: feature(START + 2 * MINUTE, { breakState: "BULLISH_ACCEPTED" }),
    referencePrice: 2501.5,
  },
  {
    state: snapshot(START + 4 * MINUTE, {
      m15: { ...snapshot(START + 4 * MINUTE).m15, state: "BALANCED", direction: "NEUTRAL" },
      m5: { ...snapshot(START + 4 * MINUTE).m5, state: "IDLE", direction: "NEUTRAL" },
      m1: { ...snapshot(START + 4 * MINUTE).m1, state: "CALM", direction: "NEUTRAL", quality: "MIXED" },
    }),
    feature: feature(START + 3 * MINUTE, {
      phase: "BALANCED",
      impulseDirection: "NEUTRAL",
      momentumCondition: "NEUTRAL",
      breakState: "NONE",
    }),
    referencePrice: 2501.2,
  },
  {
    state: snapshot(START + 5 * MINUTE, {
      m5: { ...snapshot(START + 5 * MINUTE).m5, state: "BULLISH_PULLBACK" },
      m1: { ...snapshot(START + 5 * MINUTE).m1, state: "BULLISH_PULLBACK" },
      composite: { ...snapshot(START + 5 * MINUTE).composite, state: "CORRECTION" },
    }),
    feature: feature(START + 4 * MINUTE, {
      phase: "BULLISH_PULLBACK",
      pullbackDepthPercent: 32,
      pullbackBars: 4,
      recoverySpeedRatio: null,
      momentumCondition: "STEADY_BULLISH",
    }),
    referencePrice: 2500.8,
  },
  {
    state: snapshot(START + 6 * MINUTE, {
      m5: { ...snapshot(START + 6 * MINUTE).m5, state: "BULLISH_RECOVERY" },
      m1: { ...snapshot(START + 6 * MINUTE).m1, state: "BULLISH_CONTINUATION" },
      composite: { ...snapshot(START + 6 * MINUTE).composite, state: "CORRECTION" },
    }),
    feature: feature(START + 5 * MINUTE, {
      phase: "BULLISH_PULLBACK",
      pullbackDepthPercent: 32,
      pullbackBars: 4,
      recoverySpeedRatio: 1.45,
    }),
    referencePrice: 2501.4,
  },
];

const sequence = simulateSignalDecisionSequence(samples);
assert.equal(track(sequence[0]!, "PRESSURE_RELEASE").lifecycle, "ARMED");
assert.equal(track(sequence[1]!, "PRESSURE_RELEASE").lifecycle, "CONFIRMED");
assert.equal(track(sequence[1]!, "PRESSURE_RELEASE").action, "BUY");
assert.equal(track(sequence[1]!, "PRESSURE_RELEASE").isNewEvent, true);
assert.equal(track(sequence[2]!, "PRESSURE_RELEASE").lifecycle, "CONFIRMED");
assert.equal(track(sequence[2]!, "PRESSURE_RELEASE").isNewEvent, false);
assert(track(sequence[2]!, "PRESSURE_RELEASE").reasons.includes("DUPLICATE_SUPPRESSED"));
assert.equal(track(sequence[3]!, "PRESSURE_RELEASE").lifecycle, "INVALIDATED");
assert.equal(track(sequence[5]!, "IMPULSE_RELOAD").lifecycle, "CONTINUATION");
assert.equal(track(sequence[5]!, "IMPULSE_RELOAD").action, "BUY");

const noisy = simulateSignalDecisionSequence([
  {
    state: snapshot(START + MINUTE, {
      m15: { ...snapshot(START + MINUTE).m15, state: "NOISY", direction: "NEUTRAL" },
      m5: { ...snapshot(START + MINUTE).m5, state: "BULLISH_ACCEPTANCE", availability: "PARTIAL" },
      m1: { ...snapshot(START + MINUTE).m1, state: "BULLISH_BREAK_ACCEPTED", quality: "NOISY" },
      composite: { ...snapshot(START + MINUTE).composite, state: "NOISE", availableLayers: 3 },
    }),
    feature: feature(START, { breakState: "BULLISH_ACCEPTED", noiseScore: 92 }),
    referencePrice: 2500,
  },
]);
assert.equal(track(noisy[0]!, "PRESSURE_RELEASE").lifecycle, "NO_TRADE");
assert(track(noisy[0]!, "PRESSURE_RELEASE").noTradeReasons.includes("PARTIAL_DATA"));

const watchSamples = Array.from({ length: 14 }, (_, index) => ({
  state: snapshot(START + (index + 1) * MINUTE, {
    m15: { ...snapshot(START + (index + 1) * MINUTE).m15, state: "COMPRESSION", direction: "NEUTRAL" },
    m5: { ...snapshot(START + (index + 1) * MINUTE).m5, state: "IDLE", direction: "NEUTRAL" },
    m1: { ...snapshot(START + (index + 1) * MINUTE).m1, state: "CALM", direction: "NEUTRAL", quality: "MIXED" },
    composite: { ...snapshot(START + (index + 1) * MINUTE).composite, state: "COMPRESSION" },
  }),
  feature: feature(START + index * MINUTE, {
    phase: "COMPRESSION",
    impulseDirection: "NEUTRAL",
    momentumCondition: "NEUTRAL",
    breakState: "NONE",
  }),
  referencePrice: 2500,
}));
const expiry = simulateSignalDecisionSequence(watchSamples);
assert.equal(track(expiry[0]!, "PRESSURE_RELEASE").lifecycle, "WATCH");
assert.equal(track(expiry.at(-1)!, "PRESSURE_RELEASE").lifecycle, "INVALIDATED");
assert(track(expiry.at(-1)!, "PRESSURE_RELEASE").reasons.includes("CANDIDATE_EXPIRED"));

for (let index = 1; index <= sequence.length; index += 1) {
  const prefix = simulateSignalDecisionSequence(samples.slice(0, index));
  assert.deepEqual(prefix.at(-1), sequence[index - 1]!, `future sample changed lifecycle at ${index - 1}`);
}

function complete(count: number, expected: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({
    actualChildren: expected,
    expectedChildren: expected,
    fullIntervalChildren: expected,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE" as const,
  }));
}

function generateM1(count: number): CompactCandle[] {
  const output: CompactCandle[] = new Array(count);
  let price = 2500;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const cycle = index % 1200;
    const delta = cycle < 450 ? 0.008 : cycle < 560 ? 0.001 : cycle < 760 ? -0.006 : 0.007;
    price += delta + Math.sin(index / 31) * 0.002;
    output[index] = [
      START + index * MINUTE,
      open,
      Math.max(open, price) + 0.035,
      Math.min(open, price) - 0.035,
      price,
      1,
    ];
  }
  return output;
}

function aggregate(candles: readonly CompactCandle[], size: number): CompactCandle[] {
  const output: CompactCandle[] = [];
  for (let offset = 0; offset < candles.length; offset += size) {
    const end = Math.min(candles.length, offset + size);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let index = offset; index < end; index += 1) {
      high = Math.max(high, candles[index][2]);
      low = Math.min(low, candles[index][3]);
      volume += candles[index][5];
    }
    output.push([candles[offset][0], candles[offset][1], high, low, candles[end - 1][4], volume]);
  }
  return output;
}

function datasetsFrom(m1: CompactCandle[]): Record<Timeframe, TimeframeDataset> {
  const M5 = aggregate(m1, 5);
  const M15 = aggregate(m1, 15);
  const H1 = aggregate(m1, 60);
  const D1 = aggregate(m1, 1440);
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
const index = createSignalDecisionIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
const duration = performance.now() - started;
const heapDelta = process.memoryUsage().heapUsed - beforeHeap;
assert.equal(index.summary.sampleCount, 100_000);
assert(index.latest);
assert(index.summary.strongestSignals.length <= 30);
const history = createSignalDecisionHistory(index, "00000000-0000-4000-8000-000000000000", 0, 100);
assert.equal(
  history.total,
  index.summary.confirmedSignalCount + index.summary.continuationSignalCount + index.summary.invalidationCount,
);
assert(history.items.length <= 100);
assert(history.items.every((item) => ["CONFIRMED", "CONTINUATION", "INVALIDATED"].includes(item.lifecycle)));

const anchorBars = 60_000;
const anchor = START + anchorBars * MINUTE;
const fullAtAnchor = analyzeSignalDecisionAt(index, anchor);
const prefixIndex = createSignalDecisionIndex(
  datasetsFrom(datasets.M1.candles.slice(0, anchorBars)),
  { dailyBoundaryMode: "UTC_MIDNIGHT" },
);
const prefixAtAnchor = analyzeSignalDecisionAt(prefixIndex, anchor);
assert.deepEqual(fullAtAnchor, prefixAtAnchor, "future candles changed a prior Phase 6 decision");

console.table({
  samples: index.summary.sampleCount,
  confirmed: index.summary.confirmedSignalCount,
  continuations: index.summary.continuationSignalCount,
  invalidations: index.summary.invalidationCount,
  duplicatesSuppressed: index.summary.duplicateSuppressedCount,
  phase6Ms: Number(duration.toFixed(2)),
  heapDeltaMb: Number((heapDelta / 1024 / 1024).toFixed(2)),
});
console.log("Phase 6 verification passed.");
