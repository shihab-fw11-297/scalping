import { describe, expect, it } from "vitest";
import { aggregateAllTimeframes, calculateLatestRollingWindow } from "@/lib/market/aggregate";
import type { CompactCandle } from "@/lib/market/types";

function generate(count: number, start = Date.UTC(2026, 0, 1)): CompactCandle[] {
  const result: CompactCandle[] = new Array(count);
  let price = 2600;

  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open + 0.1;
    result[index] = [start + index * 60_000, open, close + 0.2, open - 0.2, close, 1];
    price = close;
  }
  return result;
}

function options(from: number, to: number) {
  return {
    requestFromMs: from,
    requestToMs: to,
    weekendSchedule: { mode: "NEW_YORK_17" as const },
    dailyBoundaryMode: "NEW_YORK_17" as const,
  };
}

describe("aggregateAllTimeframes", () => {
  it("aggregates 60 M1 candles and records explicit coverage", () => {
    const source = generate(60);
    const result = aggregateAllTimeframes(
      source,
      options(source[0][0], source.at(-1)![0] + 60_000),
    );
    expect(result.M5.candles).toHaveLength(12);
    expect(result.M15.candles).toHaveLength(4);
    expect(result.H1.candles).toHaveLength(1);
    expect(result.D1.candles).toHaveLength(1);
    expect(result.H1.candles[0][1]).toBe(2600);
    expect(result.H1.candles[0][4]).toBeCloseTo(2606, 8);
    expect(result.H1.candles[0][5]).toBe(60);
    expect(result.H1.completeness[0]).toMatchObject({
      actualChildren: 60,
      expectedChildren: 60,
      status: "COMPLETE",
    });
    expect(result.D1.completeness[0]).toMatchObject({
      actualChildren: 60,
      expectedChildren: 60,
      status: "PARTIAL_REQUEST_BOUNDARY",
    });
  });

  it("marks a true missing child as missing data", () => {
    const source = generate(5);
    source.splice(2, 1);
    const from = Date.UTC(2026, 0, 1);
    const result = aggregateAllTimeframes(source, options(from, from + 5 * 60_000));
    expect(result.M5.candles).toHaveLength(1);
    expect(result.M5.completeness[0]).toMatchObject({
      actualChildren: 4,
      expectedChildren: 5,
      status: "MISSING_DATA",
    });
  });


  it("propagates unsafe M1 source completeness into derived candles", () => {
    const source = generate(5);
    const m1Completeness = source.map((_, index) => ({
      actualChildren: index === 2 ? 0 : 1,
      expectedChildren: 1,
      fullIntervalChildren: 1,
      expectedClosedChildren: 0,
      completenessPercent: index === 2 ? 0 : 100,
      status: index === 2 ? "MISSING_DATA" as const : "COMPLETE" as const,
    }));
    const base = options(source[0][0], source.at(-1)![0] + 60_000);
    const result = aggregateAllTimeframes(source, { ...base, m1Completeness });
    expect(result.M5.completeness[0]).toMatchObject({
      actualChildren: 4,
      expectedChildren: 5,
      status: "MISSING_DATA",
    });
  });

  it("does not call a request-boundary candle a provider data failure", () => {
    const source = generate(3, Date.UTC(2026, 0, 1, 0, 2));
    const result = aggregateAllTimeframes(
      source,
      options(source[0][0], source.at(-1)![0] + 60_000),
    );
    expect(result.M5.completeness[0].status).toBe("PARTIAL_REQUEST_BOUNDARY");
    expect(result.M5.completeness[0].completenessPercent).toBe(100);
  });
});

describe("calculateLatestRollingWindow", () => {
  it("returns the latest 300-minute summary", () => {
    const result = calculateLatestRollingWindow(generate(500), 300);
    expect(result).not.toBeNull();
    expect(result?.candlesPresent).toBe(300);
    expect(result?.completenessPercent).toBe(100);
  });
});
