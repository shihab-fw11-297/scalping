import { describe, expect, it } from "vitest";
import {
  analyzePriceBehaviourWindow,
  summarizePriceBehaviour,
} from "@/lib/market/price-behaviour";
import type { CompactCandle } from "@/lib/market/types";

const MINUTE = 60_000;

function candle(
  index: number,
  open: number,
  close: number,
  wick = 0.12,
): CompactCandle {
  return [
    Date.UTC(2026, 0, 5) + index * MINUTE,
    open,
    Math.max(open, close) + wick,
    Math.min(open, close) - wick,
    close,
    1,
  ];
}

function cleanTrend(count: number, step = 0.3): CompactCandle[] {
  const result: CompactCandle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    price += step;
    result.push(candle(index, open, price));
  }
  return result;
}

function alternating(count: number): CompactCandle[] {
  const result: CompactCandle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    price += index % 2 === 0 ? 0.45 : -0.45;
    result.push(candle(index, open, price, 0.25));
  }
  return result;
}

describe("Phase 3 price behaviour engine", () => {
  it("separates efficient directional progress from alternating noise", () => {
    const trend = analyzePriceBehaviourWindow(cleanTrend(40), 39, 1)[0];
    const noisy = analyzePriceBehaviourWindow(alternating(40), 39, 1)[0];

    expect(trend.efficiency5).toBeGreaterThan(0.95);
    expect(trend.noiseScore).toBeLessThan(noisy.noiseScore);
    expect(noisy.efficiency5).toBeLessThan(0.25);
    expect(noisy.noiseScore).toBeGreaterThan(60);
  });

  it("measures impulse, pullback depth and recovery speed without future candles", () => {
    const candles: CompactCandle[] = [];
    let price = 100;
    for (let index = 0; index < 20; index += 1) {
      const open = price;
      price += 0.02;
      candles.push(candle(index, open, price, 0.18));
    }
    for (let index = 20; index < 25; index += 1) {
      const open = price;
      price += 0.85;
      candles.push(candle(index, open, price, 0.08));
    }
    for (let index = 25; index < 28; index += 1) {
      const open = price;
      price -= 0.28;
      candles.push(candle(index, open, price, 0.08));
    }
    for (let index = 28; index < 30; index += 1) {
      const open = price;
      price += 0.24;
      candles.push(candle(index, open, price, 0.08));
    }

    const pullback = analyzePriceBehaviourWindow(candles, 27, 1)[0];
    const recovery = analyzePriceBehaviourWindow(candles, 29, 1)[0];

    expect(pullback.impulseDirection).toBe("BULLISH");
    expect(pullback.pullbackDepthPercent).not.toBeNull();
    expect(pullback.pullbackBars).toBeGreaterThan(0);
    expect(["BULLISH_PULLBACK", "MOMENTUM_DECAY"]).toContain(pullback.phase);
    expect(recovery.recoverySpeedRatio).not.toBeNull();
    expect(recovery.phase).toBe("BULLISH_RECOVERY");
  });

  it("requires persistence before calling a body break accepted", () => {
    const candles = alternating(25);
    const previousHigh = Math.max(...candles.map((item) => item[2]));
    let open = candles.at(-1)![4];
    candles.push([
      candles.at(-1)![0] + MINUTE,
      open,
      previousHigh + 0.8,
      open - 0.1,
      previousHigh + 0.5,
      1,
    ]);
    open = previousHigh + 0.5;
    candles.push([
      candles.at(-1)![0] + MINUTE,
      open,
      open + 0.4,
      previousHigh + 0.15,
      open + 0.2,
      1,
    ]);

    const first = analyzePriceBehaviourWindow(candles, 25, 1)[0];
    const second = analyzePriceBehaviourWindow(candles, 26, 1)[0];
    expect(first.breakState).toBe("BULLISH_ATTEMPT");
    expect(second.breakState).toBe("BULLISH_ACCEPTED");
    expect(second.breakLookback).toBe(20);
  });

  it("classifies a wick break that closes back inside as failed", () => {
    const candles = alternating(25);
    const previousHigh = Math.max(...candles.map((item) => item[2]));
    const open = candles.at(-1)![4];
    candles.push([
      candles.at(-1)![0] + MINUTE,
      open,
      previousHigh + 0.7,
      open - 0.2,
      previousHigh - 0.1,
      1,
    ]);

    const feature = analyzePriceBehaviourWindow(candles, 25, 1)[0];
    expect(feature.breakState).toBe("BULLISH_FAILED");
    expect(feature.breakLookback).toBe(20);
  });


  it("classifies compression and range expansion from measured volatility transitions", () => {
    const compression: CompactCandle[] = [];
    let price = 100;
    for (let index = 0; index < 20; index += 1) {
      const open = price;
      price += index % 2 === 0 ? 0.25 : -0.25;
      compression.push(candle(index, open, price, 0.45));
    }
    for (let index = 20; index < 25; index += 1) {
      const open = price;
      price += index % 2 === 0 ? 0.03 : -0.03;
      compression.push(candle(index, open, price, 0.08));
    }
    const compressed = analyzePriceBehaviourWindow(compression, 24, 1)[0];
    expect(compressed.phase).toBe("COMPRESSION");

    const expansion: CompactCandle[] = [];
    price = 100;
    for (let index = 0; index < 20; index += 1) {
      const open = price;
      price += 0.02;
      expansion.push(candle(index, open, price, 0.18));
    }
    for (let index = 20; index < 23; index += 1) {
      const open = price;
      price += 0.2;
      expansion.push(candle(index, open, price, 1));
    }
    const expanded = analyzePriceBehaviourWindow(expansion, 22, 1)[0];
    expect(expanded.phase).toBe("EXPANSION");
    expect(expanded.rangeRegimeRatio).toBeGreaterThan(1.4);
  });

  it("measures acceleration and flags an old extended impulse as late", () => {
    const candles: CompactCandle[] = [];
    let price = 100;
    for (let index = 0; index < 20; index += 1) {
      const open = price;
      price += 0.03;
      candles.push(candle(index, open, price, 0.15));
    }
    const steps = [0.15, 0.2, 0.3, 0.45, 0.65, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85];
    for (let index = 0; index < steps.length; index += 1) {
      const open = price;
      price += steps[index];
      candles.push(candle(20 + index, open, price, 0.06));
    }
    const accelerating = analyzePriceBehaviourWindow(candles, 25, 1)[0];
    const extended = analyzePriceBehaviourWindow(candles, candles.length - 1, 1)[0];
    expect(["ACCELERATING_BULLISH", "STEADY_BULLISH"]).toContain(accelerating.momentumCondition);
    expect(extended.extensionVsAverageRange20).not.toBeNull();
    expect(extended.lateEntryRisk).toBe("HIGH");
  });

  it("does not use future candles", () => {
    const candles = cleanTrend(80, 0.18);
    const prefix = analyzePriceBehaviourWindow(candles.slice(0, 41), 40, 1)[0];
    const full = analyzePriceBehaviourWindow(candles, 40, 1)[0];
    expect(full).toEqual(prefix);
  });

  it("preserves bounded context when loading a server window", () => {
    const candles = cleanTrend(200, 0.12);
    const fullPrefix = analyzePriceBehaviourWindow(candles, 0, 170).slice(150);
    const windowed = analyzePriceBehaviourWindow(candles, 150, 20);
    expect(windowed).toEqual(fullPrefix);
    expect(windowed).toHaveLength(20);
  });

  it("creates bounded summaries for all Phase 3 states", () => {
    const summary = summarizePriceBehaviour([...cleanTrend(80), ...alternating(80)], 12);
    expect(summary.candleCount).toBe(160);
    expect(summary.strongestEvents.length).toBeLessThanOrEqual(12);
    expect(summary.averageNoiseScore).toBeGreaterThanOrEqual(0);
    expect(summary.phaseCounts.BALANCED).toBeGreaterThanOrEqual(0);
    expect(summary.lateEntryRiskCounts.LOW + summary.lateEntryRiskCounts.MEDIUM + summary.lateEntryRiskCounts.HIGH).toBe(160);
  });
});
