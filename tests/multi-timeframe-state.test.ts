import { describe, expect, it } from "vitest";
import {
  analyzeMultiTimeframeStateAt,
  createMultiTimeframeStateIndex,
  summarizeMultiTimeframeStates,
} from "@/lib/market/multi-timeframe-state";
import type {
  CandleCompleteness,
  CompactCandle,
  Timeframe,
  TimeframeDataset,
} from "@/lib/market/types";

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
  const candles: CompactCandle[] = [];
  let price = 2500;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const acceleration = index % 500 < 350 ? step : -step * 0.25;
    price += acceleration;
    candles.push([
      START + index * MINUTE,
      open,
      Math.max(open, price) + 0.04,
      Math.min(open, price) - 0.04,
      price,
      1,
    ]);
  }
  return candles;
}

function aggregate(candles: readonly CompactCandle[], minutes: number): CompactCandle[] {
  const output: CompactCandle[] = [];
  for (let offset = 0; offset < candles.length; offset += minutes) {
    const group = candles.slice(offset, Math.min(candles.length, offset + minutes));
    if (group.length === 0) continue;
    output.push([
      group[0][0],
      group[0][1],
      Math.max(...group.map((item) => item[2])),
      Math.min(...group.map((item) => item[3])),
      group.at(-1)![4],
      group.reduce((sum, item) => sum + item[5], 0),
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
      while (
        length < source.candles.length &&
        source.candles[length][0] + durations[timeframe] <= anchor
      ) length += 1;
      return [
        timeframe,
        {
          candles: source.candles.slice(0, length),
          completeness: source.completeness.slice(0, length),
        },
      ];
    }),
  ) as Record<Timeframe, TimeframeDataset>;
}

describe("Phase 4 multi-timeframe market state", () => {
  it("does not use an unclosed M5 candle", () => {
    const datasets = datasetsFrom(generateM1(20, 0.02));
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });

    const beforeM5Close = analyzeMultiTimeframeStateAt(index, START + 4 * MINUTE);
    const afterM5Close = analyzeMultiTimeframeStateAt(index, START + 5 * MINUTE);

    expect(beforeM5Close?.m5.sourceTimestampMs).toBeNull();
    expect(afterM5Close?.m5.sourceTimestampMs).toBe(START);
  });


  it("respects the New York 17:00 daily close before exposing D1 state", () => {
    const dailyOpen = Date.UTC(2026, 0, 5, 22); // 17:00 New York in January
    const dailyClose = Date.UTC(2026, 0, 6, 22);
    const m1: CompactCandle[] = [
      [dailyClose - 2 * MINUTE, 100, 100.2, 99.9, 100.1, 1],
      [dailyClose - MINUTE, 100.1, 100.3, 100, 100.2, 1],
    ];
    const empty = (): TimeframeDataset => ({ candles: [], completeness: [] });
    const datasets: Record<Timeframe, TimeframeDataset> = {
      M1: { candles: m1, completeness: complete(2, 1) },
      M5: empty(),
      M15: empty(),
      H1: empty(),
      D1: {
        candles: [[dailyOpen, 99, 101, 98, 100, 1]],
        completeness: complete(1, 1440),
      },
    };
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" });
    const before = analyzeMultiTimeframeStateAt(index, dailyClose - MINUTE);
    const after = analyzeMultiTimeframeStateAt(index, dailyClose);
    expect(before?.daily.sourceTimestampMs).toBeNull();
    expect(after?.daily.sourceTimestampMs).toBe(dailyOpen);
  });

  it("builds a rolling 5H bullish campaign from measured M1 progress", () => {
    const datasets = datasetsFrom(generateM1(420, 0.03));
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
    const snapshot = analyzeMultiTimeframeStateAt(index, START + 420 * MINUTE);

    expect(snapshot?.rolling5h.availability).toBe("AVAILABLE");
    expect(snapshot?.rolling5h.direction).toBe("BULLISH");
    expect(["BULLISH_IMPULSE", "BULLISH_DECAY", "BULLISH_RECOVERY"]).toContain(snapshot?.rolling5h.stage);
    expect(snapshot?.rolling5h.efficiency).toBeGreaterThan(0.4);
  });

  it("combines all six timeframe responsibilities after enough history exists", () => {
    const datasets = datasetsFrom(generateM1(12 * 1440, 0.02));
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
    const snapshot = analyzeMultiTimeframeStateAt(index, START + 12 * 1440 * MINUTE);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.daily.availability).toBe("AVAILABLE");
    expect(snapshot?.hourly.availability).toBe("AVAILABLE");
    expect(snapshot?.m15.availability).toBe("AVAILABLE");
    expect(snapshot?.m5.availability).toBe("AVAILABLE");
    expect(snapshot?.composite.availableLayers).toBe(6);
    expect(snapshot?.composite.direction).toBe("BULLISH");
    expect(snapshot?.composite.evidenceScore).toBeGreaterThan(40);
  });

  it("produces exactly one synchronized sample per M1 candle and bounded events", () => {
    const datasets = datasetsFrom(generateM1(2_000, 0.02));
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
    const result = summarizeMultiTimeframeStates(index, 12);

    expect(result.summary.sampleCount).toBe(2_000);
    expect(result.summary.strongestEvents.length).toBeLessThanOrEqual(12);
    expect(
      result.summary.directionCounts.BULLISH +
      result.summary.directionCounts.BEARISH +
      result.summary.directionCounts.NEUTRAL,
    ).toBe(2_000);
    expect(result.latest?.timestampMs).toBe(START + 2_000 * MINUTE);
  });

  it("does not use future lower or higher timeframe candles", () => {
    const fullDatasets = datasetsFrom(generateM1(12 * 1440, 0.018));
    const anchor = START + 9 * 1440 * MINUTE;
    const prefixDatasets = truncateDatasets(fullDatasets, anchor);

    const fullState = analyzeMultiTimeframeStateAt(
      createMultiTimeframeStateIndex(fullDatasets, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
      anchor,
    );
    const prefixState = analyzeMultiTimeframeStateAt(
      createMultiTimeframeStateIndex(prefixDatasets, { dailyBoundaryMode: "UTC_MIDNIGHT" }),
      anchor,
    );

    expect(fullState).toEqual(prefixState);
  });

  it("does not promote a missing-data M5 candle into the synchronized setup layer", () => {
    const datasets = datasetsFrom(generateM1(30, 0.02));
    datasets.M5.completeness[0] = {
      ...datasets.M5.completeness[0],
      actualChildren: 3,
      completenessPercent: 60,
      status: "MISSING_DATA",
    };
    const index = createMultiTimeframeStateIndex(datasets, { dailyBoundaryMode: "UTC_MIDNIGHT" });
    const snapshot = analyzeMultiTimeframeStateAt(index, START + 5 * MINUTE);
    expect(snapshot?.m5.sourceTimestampMs).toBe(START);
    expect(snapshot?.m5.availability).toBe("PARTIAL");
    expect(snapshot?.composite.availableLayers).toBeLessThan(6);
  });
});
