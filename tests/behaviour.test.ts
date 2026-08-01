import { describe, expect, it } from "vitest";
import {
  analyzeCandleBehaviourWindow,
  summarizeCandleBehaviour,
} from "@/lib/market/behaviour";
import type { CompactCandle } from "@/lib/market/types";

function baseline(count: number): CompactCandle[] {
  const start = Date.UTC(2026, 0, 1);
  const result: CompactCandle[] = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const open = close;
    close = open + 0.1;
    result.push([start + index * 60_000, open, open + 0.6, open - 0.4, close, 1]);
  }
  return result;
}

describe("candle behaviour engine", () => {
  it("detects a measured bullish displacement", () => {
    const candles = baseline(25);
    const previous = candles.at(-1)!;
    const open = previous[4];
    candles.push([
      previous[0] + 60_000,
      open,
      open + 3.2,
      open - 0.1,
      open + 3,
      1,
    ]);

    const feature = analyzeCandleBehaviourWindow(candles, 25, 1)[0];
    expect(feature.tags).toContain("BULLISH_DISPLACEMENT");
    expect(feature.maximumHighBreakLookback).toBe(20);
    expect(feature.rangeVsAverage20).toBeGreaterThan(3);
    expect(feature.breakBehaviour).toBe("BULLISH_BODY_BREAK");
  });

  it("detects a high wick sweep without calling it a body break", () => {
    const candles = baseline(5);
    const previous = candles.at(-1)!;
    candles.push([
      previous[0] + 60_000,
      previous[4],
      previous[2] + 1,
      previous[3] + 0.1,
      previous[2] - 0.1,
      1,
    ]);
    const feature = analyzeCandleBehaviourWindow(candles, 5, 1)[0];
    expect(feature.tags).toContain("WICK_SWEEP_HIGH");
    expect(feature.breakBehaviour).toBe("HIGH_WICK_BREAK");
  });

  it("does not use future candles", () => {
    const candles = baseline(40);
    const fromPrefix = analyzeCandleBehaviourWindow(candles.slice(0, 21), 20, 1)[0];
    const fromFull = analyzeCandleBehaviourWindow(candles, 20, 1)[0];
    expect(fromFull).toEqual(fromPrefix);
  });

  it("creates a complete summary with bounded strongest events", () => {
    const summary = summarizeCandleBehaviour(baseline(100), 10);
    expect(summary.candleCount).toBe(100);
    expect(summary.strongestEvents.length).toBeLessThanOrEqual(10);
    expect(summary.medianRange).toBeGreaterThan(0);
  });
});
