import { describe, expect, it } from "vitest";
import {
  analyzeHypothesesAndOpportunitiesAt,
  createHypothesisOpportunityIndex,
  evaluateHypothesesAndOpportunities,
} from "@/lib/market/hypothesis-opportunity";
import type {
  CandleCompleteness,
  CompactCandle,
  MultiTimeframeStateSnapshot,
  PriceBehaviour,
  Timeframe,
  TimeframeDataset,
} from "@/lib/market/types";

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 5);

function baseFeature(overrides: Partial<PriceBehaviour> = {}): PriceBehaviour {
  return {
    timestampMs: START,
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

function baseSnapshot(overrides: Partial<MultiTimeframeStateSnapshot> = {}): MultiTimeframeStateSnapshot {
  const snapshot: MultiTimeframeStateSnapshot = {
    timestampMs: START + MINUTE,
    daily: {
      sourceTimestampMs: START - 24 * 60 * MINUTE,
      availability: "AVAILABLE",
      condition: "BULLISH_TREND",
      direction: "BULLISH",
      strength: 72,
      rangePositionPercent: 60,
      volatilityRatio: 1.1,
      maturity: "DEVELOPING",
    },
    rolling5h: {
      fromTimestampMs: START - 299 * MINUTE,
      toTimestampMs: START + MINUTE,
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
      sourceTimestampMs: START - 60 * MINUTE,
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
      sourceTimestampMs: START - 15 * MINUTE,
      availability: "AVAILABLE",
      state: "BULLISH_PRESSURE",
      direction: "BULLISH",
      strength: 76,
      pressureScore: 75,
    },
    m5: {
      sourceTimestampMs: START - 5 * MINUTE,
      availability: "AVAILABLE",
      state: "BULLISH_PRESSURE",
      direction: "BULLISH",
      constructionScore: 76,
      freshnessScore: 72,
      lateEntryRisk: "LOW",
    },
    m1: {
      sourceTimestampMs: START,
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
  return { ...snapshot, ...overrides };
}

function complete(count: number, expectedChildren: number): CandleCompleteness[] {
  return Array.from({ length: count }, () => ({
    actualChildren: expectedChildren,
    expectedChildren,
    fullIntervalChildren: expectedChildren,
    expectedClosedChildren: 0,
    completenessPercent: 100,
    status: "COMPLETE" as const,
  }));
}

function generateM1(count: number): CompactCandle[] {
  const output: CompactCandle[] = [];
  let price = 2500;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const cycle = index % 600;
    const change = cycle < 360 ? 0.018 : cycle < 470 ? -0.008 : 0.012;
    price += change;
    output.push([
      START + index * MINUTE,
      open,
      Math.max(open, price) + 0.035,
      Math.min(open, price) - 0.035,
      price,
      1,
    ]);
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

describe("Phase 5 hypothesis and opportunity engine", () => {
  it("ranks the bullish hypothesis as leading from coherent evidence", () => {
    const result = evaluateHypothesesAndOpportunities(baseSnapshot(), baseFeature());
    expect(result.leadingHypothesis).toBe("BULLISH");
    expect(result.hypotheses.find((item) => item.direction === "BULLISH")?.state).toBe("LEADING");
    expect(result.leadingHypothesisScore).toBeGreaterThan(60);
  });

  it("ranks range when all layers describe balance/compression", () => {
    const snapshot = baseSnapshot({
      daily: { ...baseSnapshot().daily, condition: "RANGE", direction: "NEUTRAL", strength: 35 },
      rolling5h: { ...baseSnapshot().rolling5h, stage: "BALANCE", direction: "NEUTRAL", strength: 35 },
      hourly: { ...baseSnapshot().hourly, zone: "MID_RANGE", condition: "RANGE_LOCATION", direction: "NEUTRAL" },
      m15: { ...baseSnapshot().m15, state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...baseSnapshot().m5, state: "COMPRESSION_BUILDING", direction: "NEUTRAL" },
      m1: { ...baseSnapshot().m1, state: "CALM", direction: "NEUTRAL", quality: "MIXED" },
      composite: { ...baseSnapshot().composite, direction: "NEUTRAL", alignment: "NEUTRAL", state: "RANGE", evidenceScore: 48 },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature({
      phase: "COMPRESSION",
      impulseDirection: "NEUTRAL",
      momentumCondition: "NEUTRAL",
      breakState: "NONE",
      noiseScore: 38,
    }));
    expect(result.leadingHypothesis).toBe("RANGE");
  });

  it("creates a mature Pressure Release candidate only after acceptance", () => {
    const snapshot = baseSnapshot({
      m15: { ...baseSnapshot().m15, state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...baseSnapshot().m5, state: "BULLISH_ACCEPTANCE" },
      m1: { ...baseSnapshot().m1, state: "BULLISH_BREAK_ACCEPTED" },
      composite: { ...baseSnapshot().composite, state: "COMPRESSION" },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature({ breakState: "BULLISH_ACCEPTED" }));
    const opportunity = result.opportunities.find((item) => item.family === "PRESSURE_RELEASE");
    expect(opportunity?.direction).toBe("BULLISH");
    expect(opportunity?.stage).toBe("MATURE_CANDIDATE");
  });

  it("maps a failed bullish break to bearish reversal evidence", () => {
    const snapshot = baseSnapshot({
      hourly: { ...baseSnapshot().hourly, zone: "ABOVE_RANGE", condition: "BREAKOUT_LOCATION" },
      m1: { ...baseSnapshot().m1, state: "FAILED_BREAK", direction: "BEARISH" },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature({
      breakState: "BULLISH_FAILED",
      phase: "BEARISH_RECOVERY",
      impulseDirection: "BEARISH",
      momentumCondition: "ACCELERATING_BEARISH",
    }));
    const opportunity = result.opportunities.find((item) => item.family === "FAILED_BREAK_REVERSAL");
    expect(opportunity?.direction).toBe("BEARISH");
    expect(["DEVELOPING", "MATURE_CANDIDATE"]).toContain(opportunity?.stage);
  });

  it("identifies an impulse reload from controlled pullback and recovery", () => {
    const snapshot = baseSnapshot({
      m5: { ...baseSnapshot().m5, state: "BULLISH_RECOVERY" },
      m1: { ...baseSnapshot().m1, state: "BULLISH_CONTINUATION" },
      composite: { ...baseSnapshot().composite, state: "CORRECTION" },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature({
      phase: "BULLISH_PULLBACK",
      pullbackDepthPercent: 32,
      pullbackBars: 4,
      recoverySpeedRatio: 1.45,
    }));
    const opportunity = result.opportunities.find((item) => item.family === "IMPULSE_RELOAD");
    expect(opportunity?.direction).toBe("BULLISH");
    expect(opportunity?.score).toBeGreaterThan(60);
  });

  it("identifies timeframe rotation without calling it a signal", () => {
    const snapshot = baseSnapshot({
      m15: { ...baseSnapshot().m15, state: "ROTATION", direction: "NEUTRAL" },
      m5: { ...baseSnapshot().m5, state: "BULLISH_RECOVERY" },
      m1: { ...baseSnapshot().m1, state: "BULLISH_IGNITION" },
      composite: { ...baseSnapshot().composite, alignment: "PRODUCTIVE_DISAGREEMENT", state: "ROTATION" },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature());
    const opportunity = result.opportunities.find((item) => item.family === "TIMEFRAME_ROTATION");
    expect(opportunity?.direction).toBe("BULLISH");
    expect(opportunity?.stage).toBe("MATURE_CANDIDATE");
  });

  it("degrades an otherwise attractive opportunity when data is partial and noisy", () => {
    const snapshot = baseSnapshot({
      m15: { ...baseSnapshot().m15, availability: "PARTIAL", state: "COMPRESSION", direction: "NEUTRAL" },
      m5: { ...baseSnapshot().m5, availability: "PARTIAL", state: "BULLISH_ACCEPTANCE" },
      m1: { ...baseSnapshot().m1, state: "BULLISH_BREAK_ACCEPTED", quality: "NOISY" },
      composite: { ...baseSnapshot().composite, state: "NOISE", availableLayers: 3 },
    });
    const result = evaluateHypothesesAndOpportunities(snapshot, baseFeature({ breakState: "BULLISH_ACCEPTED", noiseScore: 90 }));
    expect(result.opportunities.some((item) => item.stage === "MATURE_CANDIDATE")).toBe(false);
    expect(result.opportunities.some((item) => item.stage === "DEGRADED")).toBe(true);
  });

  it("does not change a past result when future candles are present", () => {
    const full = datasetsFrom(generateM1(12 * 1440));
    const anchor = START + 8 * 1440 * MINUTE;
    const prefixM1 = full.M1.candles.filter((item) => item[0] + MINUTE <= anchor);
    const prefix = datasetsFrom(prefixM1);
    const fullResult = analyzeHypothesesAndOpportunitiesAt(
      createHypothesisOpportunityIndex(full, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
      anchor,
    );
    const prefixResult = analyzeHypothesesAndOpportunitiesAt(
      createHypothesisOpportunityIndex(prefix, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
      anchor,
    );
    expect(fullResult).toEqual(prefixResult);
  });
});
