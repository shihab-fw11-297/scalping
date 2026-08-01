import { afterEach, describe, expect, it } from "vitest";
import { analysisCache } from "@/lib/market/analysis-cache";
import type { CompactCandle, Timeframe, TimeframeDataset } from "@/lib/market/types";

function dataset(count: number): TimeframeDataset {
  const candles: CompactCandle[] = Array.from({ length: count }, (_, index) => [
    index * 60_000,
    100,
    101,
    99,
    100,
    1,
  ]);
  return {
    candles,
    completeness: Array.from({ length: count }, () => ({
      actualChildren: 1,
      expectedChildren: 1,
      fullIntervalChildren: 1,
      expectedClosedChildren: 0,
      completenessPercent: 100,
      status: "COMPLETE" as const,
    })),
  };
}

function fakeAnalysis(m1Count: number) {
  const empty = dataset(0);
  const datasets = {
    M1: dataset(m1Count),
    M5: empty,
    M15: empty,
    H1: empty,
    D1: empty,
  } satisfies Record<Timeframe, TimeframeDataset>;

  return {
    meta: {},
    quality: {},
    datasets,
    behaviourSummaries: {},
    priceBehaviourSummaries: {},
    marketStateSummary: {},
    latestMarketState: null,
    rolling5hLatest: null,
  } as never;
}

afterEach(() => analysisCache.clear());

describe("analysis cache candle budget", () => {
  it("evicts the least-recently-used analysis before exceeding the candle budget", () => {
    const first = analysisCache.create(fakeAnalysis(80), {
      ttlMs: 60_000,
      maxEntries: 5,
      maxTotalCandles: 120,
    });
    const second = analysisCache.create(fakeAnalysis(80), {
      ttlMs: 60_000,
      maxEntries: 5,
      maxTotalCandles: 120,
    });

    expect(analysisCache.get(first.id)).toBeNull();
    expect(analysisCache.get(second.id)).not.toBeNull();
    expect(analysisCache.totalCandles()).toBe(80);
  });
});
