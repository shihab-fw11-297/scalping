import { describe, expect, it } from "vitest";
import {
  getDailyBucketStart,
  getNextDailyBucketStart,
  isExpectedForexClosure,
} from "@/lib/market/market-session";

describe("New York market-session boundaries", () => {
  it("uses 22:00 UTC for New York 17:00 in winter", () => {
    const timestamp = Date.UTC(2026, 0, 6, 12);
    expect(getDailyBucketStart(timestamp, "NEW_YORK_17")).toBe(Date.UTC(2026, 0, 5, 22));
  });

  it("uses 21:00 UTC for New York 17:00 in summer", () => {
    const timestamp = Date.UTC(2026, 6, 6, 12);
    expect(getDailyBucketStart(timestamp, "NEW_YORK_17")).toBe(Date.UTC(2026, 6, 5, 21));
  });

  it("creates a 23-hour trading day across spring DST", () => {
    const start = Date.UTC(2026, 2, 7, 22);
    const next = getNextDailyBucketStart(start, "NEW_YORK_17");
    expect((next - start) / 3_600_000).toBe(23);
  });

  it("classifies closure using local New York time", () => {
    expect(isExpectedForexClosure(Date.UTC(2026, 6, 3, 21), { mode: "NEW_YORK_17" })).toBe(true);
    expect(isExpectedForexClosure(Date.UTC(2026, 6, 5, 20, 59), { mode: "NEW_YORK_17" })).toBe(true);
    expect(isExpectedForexClosure(Date.UTC(2026, 6, 5, 21), { mode: "NEW_YORK_17" })).toBe(false);
  });
});
