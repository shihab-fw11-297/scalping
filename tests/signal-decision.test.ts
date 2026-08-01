import { describe, expect, it } from "vitest";
import { simulateSignalDecisionSequence } from "../src/lib/market/signal-decision";
import type { MultiTimeframeStateSnapshot, PriceBehaviour } from "../src/lib/market/types";

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 5);

function feature(timestampMs: number, overrides: Partial<PriceBehaviour> = {}): PriceBehaviour {
  return {
    timestampMs,
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

function snapshot(timestampMs: number, accepted = false): MultiTimeframeStateSnapshot {
  return {
    timestampMs,
    daily: { sourceTimestampMs: timestampMs - 1440 * MINUTE, availability: "AVAILABLE", condition: "BULLISH_TREND", direction: "BULLISH", strength: 72, rangePositionPercent: 60, volatilityRatio: 1.1, maturity: "DEVELOPING" },
    rolling5h: { fromTimestampMs: timestampMs - 300 * MINUTE, toTimestampMs: timestampMs, availability: "AVAILABLE", stage: "BULLISH_IMPULSE", direction: "BULLISH", strength: 75, efficiency: 0.68, rangePositionPercent: 70, recentProgressRatio: 1.3, candlesPresent: 300 },
    hourly: { sourceTimestampMs: timestampMs - 60 * MINUTE, availability: "AVAILABLE", zone: "UPPER_QUARTILE", condition: "WITH_TREND_PULLBACK", direction: "BULLISH", rangePositionPercent: 68, distanceToUpperInAverageRanges: 1.8, distanceToLowerInAverageRanges: 3.1, locationQuality: 72 },
    m15: { sourceTimestampMs: timestampMs - 15 * MINUTE, availability: "AVAILABLE", state: "COMPRESSION", direction: "NEUTRAL", strength: 76, pressureScore: 75 },
    m5: { sourceTimestampMs: timestampMs - 5 * MINUTE, availability: "AVAILABLE", state: accepted ? "BULLISH_ACCEPTANCE" : "BULLISH_BREAK_ATTEMPT", direction: "BULLISH", constructionScore: 76, freshnessScore: 72, lateEntryRisk: "LOW" },
    m1: { sourceTimestampMs: timestampMs - MINUTE, state: accepted ? "BULLISH_BREAK_ACCEPTED" : "BULLISH_BREAK_ATTEMPT", direction: "BULLISH", quality: "CLEAN", intensity: 82, freshnessScore: 80, lateEntryRisk: "LOW" },
    composite: { direction: "BULLISH", alignment: "FRESH_ALIGNMENT", state: "COMPRESSION", evidenceScore: 76, agreementCount: 6, conflictCount: 0, availableLayers: 6 },
  };
}

function pressureTrack(step: ReturnType<typeof simulateSignalDecisionSequence>[number]) {
  return step.tracks.find((item) => item.family === "PRESSURE_RELEASE")!;
}

describe("Phase 6 signal lifecycle", () => {
  it("arms, confirms, and suppresses duplicate confirmation", () => {
    const sequence = simulateSignalDecisionSequence([
      { state: snapshot(START + MINUTE), feature: feature(START, { phase: "COMPRESSION", breakState: "BULLISH_ATTEMPT" }), referencePrice: 2500 },
      { state: snapshot(START + 2 * MINUTE, true), feature: feature(START + MINUTE, { breakState: "BULLISH_ACCEPTED" }), referencePrice: 2501 },
      { state: snapshot(START + 3 * MINUTE, true), feature: feature(START + 2 * MINUTE, { breakState: "BULLISH_ACCEPTED" }), referencePrice: 2502 },
    ]);
    expect(pressureTrack(sequence[0]).lifecycle).toBe("ARMED");
    expect(pressureTrack(sequence[1]).lifecycle).toBe("CONFIRMED");
    expect(pressureTrack(sequence[1]).action).toBe("BUY");
    expect(pressureTrack(sequence[1]).isNewEvent).toBe(true);
    expect(pressureTrack(sequence[2]).isNewEvent).toBe(false);
    expect(pressureTrack(sequence[2]).reasons).toContain("DUPLICATE_SUPPRESSED");
  });

  it("is prefix-stable and therefore no-lookahead", () => {
    const samples = [
      { state: snapshot(START + MINUTE), feature: feature(START, { phase: "COMPRESSION", breakState: "BULLISH_ATTEMPT" }), referencePrice: 2500 },
      { state: snapshot(START + 2 * MINUTE, true), feature: feature(START + MINUTE, { breakState: "BULLISH_ACCEPTED" }), referencePrice: 2501 },
      { state: snapshot(START + 3 * MINUTE, true), feature: feature(START + 2 * MINUTE, { breakState: "BULLISH_ACCEPTED" }), referencePrice: 2502 },
    ];
    const full = simulateSignalDecisionSequence(samples);
    for (let length = 1; length <= samples.length; length += 1) {
      const prefix = simulateSignalDecisionSequence(samples.slice(0, length));
      expect(prefix.at(-1)).toEqual(full[length - 1]);
    }
  });
});
