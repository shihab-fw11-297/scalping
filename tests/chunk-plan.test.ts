import { describe, expect, it } from "vitest";
import { planFinageDateChunks } from "@/lib/market/chunk-plan";

const DAY = 86_400_000;

describe("planFinageDateChunks", () => {
  it("splits a large M1 range below the provider request limit", () => {
    const chunks = planFinageDateChunks({
      fromTimestampMs: Date.UTC(2026, 0, 1),
      toTimestampMs: Date.UTC(2026, 2, 31),
      multiplierMinutes: 1,
      targetMaxResults: 45_000,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const from = Date.parse(`${chunk.fromDate}T00:00:00Z`);
      const to = Date.parse(`${chunk.toDate}T00:00:00Z`);
      const inclusiveDays = Math.floor((to - from) / DAY) + 1;
      expect(inclusiveDays * 1440).toBeLessThanOrEqual(45_000);
    }
  });
});
