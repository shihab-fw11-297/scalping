import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  analyzeMultiTimeframeStateAt,
  createMultiTimeframeStateIndex,
  summarizeMultiTimeframeStates,
} from "../src/lib/market/multi-timeframe-state";
import type {
  CandleCompleteness,
  CompactCandle,
  Timeframe,
  TimeframeDataset,
} from "../src/lib/market/types";

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 5);

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

function generateM1(count: number, step = 0.015): CompactCandle[] {
  const candles: CompactCandle[] = new Array(count);
  let price = 2500;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const cycle = index % 900;
    const change = cycle < 600 ? step : cycle < 760 ? -step * 0.35 : step * 0.65;
    price += change;
    candles[index] = [
      START + index * MINUTE,
      open,
      Math.max(open, price) + 0.04,
      Math.min(open, price) - 0.04,
      price,
      1,
    ];
  }
  return candles;
}

function aggregate(candles: readonly CompactCandle[], minutes: number): CompactCandle[] {
  const output: CompactCandle[] = [];
  for (let offset = 0; offset < candles.length; offset += minutes) {
    const end = Math.min(candles.length, offset + minutes);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let index = offset; index < end; index += 1) {
      high = Math.max(high, candles[index][2]);
      low = Math.min(low, candles[index][3]);
      volume += candles[index][5];
    }
    output.push([
      candles[offset][0],
      candles[offset][1],
      high,
      low,
      candles[end - 1][4],
      volume,
    ]);
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


function truncateDatasets(
  datasets: Record<Timeframe, TimeframeDataset>,
  anchor: number,
): Record<Timeframe, TimeframeDataset> {
  const durations: Record<Timeframe, number> = {
    M1: MINUTE,
    M5: 5 * MINUTE,
    M15: 15 * MINUTE,
    H1: 60 * MINUTE,
    D1: 1440 * MINUTE,
  };
  return Object.fromEntries(
    (Object.keys(datasets) as Timeframe[]).map((timeframe) => {
      const source = datasets[timeframe];
      let length = 0;
      while (length < source.candles.length && source.candles[length][0] + durations[timeframe] <= anchor) {
        length += 1;
      }
      return [timeframe, {
        candles: source.candles.slice(0, length),
        completeness: source.completeness.slice(0, length),
      }];
    }),
  ) as Record<Timeframe, TimeframeDataset>;
}

const small = datasetsFrom(generateM1(420, 0.03));
const smallIndex = createMultiTimeframeStateIndex(small, { dailyBoundaryMode: "UTC_MIDNIGHT" });
const beforeClose = analyzeMultiTimeframeStateAt(smallIndex, START + 4 * MINUTE);
const afterClose = analyzeMultiTimeframeStateAt(smallIndex, START + 5 * MINUTE);
assert.equal(beforeClose?.m5.sourceTimestampMs, null, "unclosed M5 leaked into state");
assert.equal(afterClose?.m5.sourceTimestampMs, START, "closed M5 was not synchronized");
const rolling = analyzeMultiTimeframeStateAt(smallIndex, START + 420 * MINUTE);
assert.equal(rolling?.rolling5h.availability, "AVAILABLE");
assert.equal(rolling?.rolling5h.direction, "BULLISH");

const full = datasetsFrom(generateM1(12 * 1440, 0.02));
const fullIndex = createMultiTimeframeStateIndex(full, { dailyBoundaryMode: "UTC_MIDNIGHT" });
const fullSnapshot = analyzeMultiTimeframeStateAt(fullIndex, START + 12 * 1440 * MINUTE);
if (!fullSnapshot) throw new Error("latest snapshot missing");
assert.equal(fullSnapshot.composite.availableLayers, 6);
assert.notEqual(fullSnapshot.composite.state, "INSUFFICIENT_DATA");

const anchor = START + 9 * 1440 * MINUTE;
const prefix = truncateDatasets(full, anchor);
const fullAtAnchor = analyzeMultiTimeframeStateAt(fullIndex, anchor);
const prefixAtAnchor = analyzeMultiTimeframeStateAt(
  createMultiTimeframeStateIndex(prefix, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
  anchor,
);
assert.deepEqual(fullAtAnchor, prefixAtAnchor, "future candles changed a prior synchronized state");

const incomplete = datasetsFrom(generateM1(30, 0.02));
incomplete.M5.completeness[0] = {
  ...incomplete.M5.completeness[0],
  actualChildren: 3,
  completenessPercent: 60,
  status: "MISSING_DATA",
};
const incompleteState = analyzeMultiTimeframeStateAt(
  createMultiTimeframeStateIndex(incomplete, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
  START + 5 * MINUTE,
);
assert.equal(incompleteState?.m5.availability, "PARTIAL");
assert.equal(incompleteState?.m5.sourceTimestampMs, START);

const memoryBefore = process.memoryUsage().heapUsed;
const benchmarkDatasets = datasetsFrom(generateM1(100_000, 0.006));
const started = performance.now();
const benchmarkIndex = createMultiTimeframeStateIndex(benchmarkDatasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
const benchmarkResult = summarizeMultiTimeframeStates(benchmarkIndex);
const duration = performance.now() - started;
const heapDelta = process.memoryUsage().heapUsed - memoryBefore;
assert.equal(benchmarkResult.summary.sampleCount, 100_000);
assert(benchmarkResult.latest, "100K latest snapshot missing");
assert(benchmarkResult.summary.strongestEvents.length <= 24);

console.table({
  samples: benchmarkResult.summary.sampleCount,
  evidenceAverage: benchmarkResult.summary.averageEvidenceScore,
  latestState: benchmarkResult.latest?.composite.state,
  latestAlignment: benchmarkResult.latest?.composite.alignment,
  phase4Ms: Number(duration.toFixed(2)),
  heapDeltaMb: Number((heapDelta / 1024 / 1024).toFixed(2)),
});
console.log("Phase 4 verification passed.");
