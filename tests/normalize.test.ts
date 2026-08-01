import { describe, expect, it } from "vitest";
import { dedupeSortedCandles, normalizeFinageAggregates } from "@/lib/market/normalize";

const FROM = Date.UTC(2026, 0, 1, 0, 0);
const TO = Date.UTC(2026, 0, 1, 1, 0);

describe("normalizeFinageAggregates", () => {
  it("uses exact [from,to) boundaries and validates OHLC", () => {
    const result = normalizeFinageAggregates(
      [
        { t: FROM + 60_000, o: 100, h: 102, l: 99, c: 101, v: 2 },
        { t: FROM, o: 99, h: 101, l: 98, c: 100, v: 1 },
        { t: FROM + 120_000, o: 100, h: 99, l: 98, c: 101, v: 3 },
        { t: FROM - 60_000, o: 98, h: 99, l: 97, c: 98.5, v: 1 },
        { t: TO, o: 101, h: 102, l: 100, c: 101.5, v: 1 },
      ],
      FROM,
      TO,
    );

    expect(result.outOfOrderDetected).toBe(true);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0][0]).toBe(FROM);
    expect(result.candles.some((candle) => candle[0] === TO)).toBe(false);
    expect(result.filteredOutsideRange).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("INVALID_OHLC");
  });
});

describe("dedupeSortedCandles", () => {
  it("removes exact duplicates and reports conflicts", () => {
    const result = dedupeSortedCandles([
      [FROM, 100, 101, 99, 100.5, 1],
      [FROM, 100, 101, 99, 100.5, 1],
      [FROM + 60_000, 100.5, 102, 100, 101.5, 2],
      [FROM + 60_000, 100.5, 103, 100, 102, 2],
    ]);

    expect(result.candles).toHaveLength(2);
    expect(result.duplicates).toBe(2);
    expect(result.duplicateConflicts).toBe(1);
  });
});
