import { describe, expect, it } from "vitest";
import { FixedMinHeap } from "@/lib/market/fixed-min-heap";
import { percentile, quickselect } from "@/lib/market/quickselect";

describe("Phase 2 DSA helpers", () => {
  it("keeps only the strongest N events", () => {
    const heap = new FixedMinHeap<number>(3, (value) => value);
    [1, 9, 3, 7, 5].forEach((value) => heap.push(value));
    expect(heap.toDescendingArray()).toEqual([9, 7, 5]);
  });

  it("calculates a median without sorting the source array", () => {
    const values = [9, 1, 5, 3, 7, 2, 8, 4, 6];
    const original = [...values];
    expect(percentile(values, 0.5)).toBe(5);
    expect(values).toEqual(original);
  });

  it("handles 100K equal values without quadratic degeneration", () => {
    const values = new Array<number>(100_000).fill(0.4);
    expect(quickselect(values, 50_000)).toBe(0.4);
  });
});
