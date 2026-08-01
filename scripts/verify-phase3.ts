import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  analyzePriceBehaviourWindow,
  summarizePriceBehaviour,
} from "../src/lib/market/price-behaviour";
import type { CompactCandle } from "../src/lib/market/types";

const MINUTE = 60_000;

function makeCandle(index: number, open: number, close: number, wick = 0.12): CompactCandle {
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
  const candles: CompactCandle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    price += step;
    candles.push(makeCandle(index, open, price));
  }
  return candles;
}

function alternating(count: number): CompactCandle[] {
  const candles: CompactCandle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    price += index % 2 === 0 ? 0.45 : -0.45;
    candles.push(makeCandle(index, open, price, 0.25));
  }
  return candles;
}

const trend = analyzePriceBehaviourWindow(cleanTrend(50), 49, 1)[0];
const noise = analyzePriceBehaviourWindow(alternating(50), 49, 1)[0];
assert.ok(trend.efficiency5 > 0.95, "Clean directional progress must be efficient.");
assert.ok(noise.noiseScore > trend.noiseScore, "Alternating movement must score noisier than a clean trend.");

const breakCandles = alternating(25);
const previousHigh = Math.max(...breakCandles.map((item) => item[2]));
let open = breakCandles.at(-1)![4];
breakCandles.push([
  breakCandles.at(-1)![0] + MINUTE,
  open,
  previousHigh + 0.8,
  open - 0.1,
  previousHigh + 0.5,
  1,
]);
open = previousHigh + 0.5;
breakCandles.push([
  breakCandles.at(-1)![0] + MINUTE,
  open,
  open + 0.4,
  previousHigh + 0.15,
  open + 0.2,
  1,
]);
const breakFeatures = analyzePriceBehaviourWindow(breakCandles, 25, 2);
assert.equal(breakFeatures[0].breakState, "BULLISH_ATTEMPT");
assert.equal(breakFeatures[1].breakState, "BULLISH_ACCEPTED");

const noLookaheadCandles = cleanTrend(200, 0.12);
const prefix = analyzePriceBehaviourWindow(noLookaheadCandles.slice(0, 151), 150, 1)[0];
const full = analyzePriceBehaviourWindow(noLookaheadCandles, 150, 1)[0];
assert.deepEqual(full, prefix, "Future candles must not alter an earlier price-behaviour result.");
const fullPrefixWindow = analyzePriceBehaviourWindow(noLookaheadCandles, 0, 170).slice(150);
const boundedWindow = analyzePriceBehaviourWindow(noLookaheadCandles, 150, 20);
assert.deepEqual(boundedWindow, fullPrefixWindow, "Bounded context must match full-prefix analysis.");

const large: CompactCandle[] = new Array(100_000);
let price = 2_600;
for (let index = 0; index < large.length; index += 1) {
  const openPrice = price;
  price += Math.sin(index / 41) * 0.04 + 0.005;
  large[index] = makeCandle(index, openPrice, price, 0.2);
}
const started = performance.now();
const summary = summarizePriceBehaviour(large);
const latest = analyzePriceBehaviourWindow(large, 95_000, 5_000);
const durationMs = performance.now() - started;
assert.equal(summary.candleCount, 100_000);
assert.equal(latest.length, 5_000);
assert.ok(durationMs < 5_000, `Phase 3 100K verification exceeded 5 seconds: ${durationMs.toFixed(2)} ms.`);

console.table({
  directionalEfficiency: Number(trend.efficiency5.toFixed(3)),
  alternatingNoiseScore: Number(noise.noiseScore.toFixed(2)),
  acceptedBreak: breakFeatures[1].breakState,
  verifiedCandles: summary.candleCount,
  windowCandles: latest.length,
  phase3VerificationMs: Number(durationMs.toFixed(2)),
});
