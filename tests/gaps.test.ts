import { describe, expect, it } from "vitest";
import { detectGaps } from "@/lib/market/gaps";

const SCHEDULE = { mode: "NEW_YORK_17" as const };

describe("detectGaps", () => {
  it("detects missing tradable intervals", () => {
    const t = Date.UTC(2026, 0, 1, 10, 0);
    const result = detectGaps(
      [
        [t, 1, 1, 1, 1, 0],
        [t + 60_000, 1, 1, 1, 1, 0],
        [t + 4 * 60_000, 1, 1, 1, 1, 0],
      ],
      60_000,
      SCHEDULE,
    );

    expect(result.gaps).toHaveLength(1);
    expect(result.missingTradableCandles).toBe(2);
    expect(result.expectedClosedCandles).toBe(0);
    expect(result.gaps[0].classification).toBe("MISSING_TRADABLE_INTERVAL");
  });

  it("separates winter weekend closure using New York 17:00", () => {
    const friday = Date.UTC(2026, 0, 2, 21, 59);
    const sundayOpen = Date.UTC(2026, 0, 4, 22, 0);
    const result = detectGaps(
      [
        [friday, 1, 1, 1, 1, 0],
        [sundayOpen, 1, 1, 1, 1, 0],
      ],
      60_000,
      SCHEDULE,
    );

    expect(result.missingTradableCandles).toBe(0);
    expect(result.expectedClosedCandles).toBe(2_880);
    expect(result.gaps[0].classification).toBe("EXPECTED_MARKET_CLOSURE");
  });

  it("separates summer weekend closure after DST shift", () => {
    const friday = Date.UTC(2026, 6, 3, 20, 59);
    const sundayOpen = Date.UTC(2026, 6, 5, 21, 0);
    const result = detectGaps(
      [
        [friday, 1, 1, 1, 1, 0],
        [sundayOpen, 1, 1, 1, 1, 0],
      ],
      60_000,
      SCHEDULE,
    );

    expect(result.missingTradableCandles).toBe(0);
    expect(result.expectedClosedCandles).toBe(2_880);
  });
});
