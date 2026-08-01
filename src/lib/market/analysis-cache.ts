import { randomUUID } from "node:crypto";
import type { CachedAnalysis, Timeframe } from "./types";

interface CacheOptions {
  ttlMs: number;
  maxEntries: number;
  maxTotalCandles: number;
}

const TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "H1", "D1"];

function candleWeight(analysis: Pick<CachedAnalysis, "datasets">): number {
  let total = 0;
  for (const timeframe of TIMEFRAMES) total += analysis.datasets[timeframe].candles.length;
  return total;
}

class AnalysisCache {
  private readonly entries = new Map<string, CachedAnalysis>();

  create(
    analysis: Omit<CachedAnalysis, "id" | "createdAtMs" | "expiresAtMs">,
    options: CacheOptions,
  ): CachedAnalysis {
    this.removeExpired();
    const incomingWeight = candleWeight(analysis);

    while (
      this.entries.size > 0 &&
      (
        this.entries.size >= options.maxEntries ||
        this.totalCandleWeight() + incomingWeight > options.maxTotalCandles
      )
    ) {
      this.deleteOldest();
    }

    const now = Date.now();
    const cached: CachedAnalysis = {
      ...analysis,
      id: randomUUID(),
      createdAtMs: now,
      expiresAtMs: now + options.ttlMs,
    };
    this.entries.set(cached.id, cached);
    return cached;
  }

  get(id: string): CachedAnalysis | null {
    const value = this.entries.get(id);
    if (!value) return null;
    if (value.expiresAtMs <= Date.now()) {
      this.entries.delete(id);
      return null;
    }

    // Map insertion order provides an O(1) LRU refresh.
    this.entries.delete(id);
    this.entries.set(id, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    this.removeExpired();
    return this.entries.size;
  }

  totalCandles(): number {
    this.removeExpired();
    return this.totalCandleWeight();
  }

  private totalCandleWeight(): number {
    let total = 0;
    for (const value of this.entries.values()) total += candleWeight(value);
    return total;
  }

  private deleteOldest(): void {
    const oldestKey = this.entries.keys().next().value as string | undefined;
    if (oldestKey) this.entries.delete(oldestKey);
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.entries) {
      if (value.expiresAtMs <= now) this.entries.delete(key);
    }
  }
}

export const analysisCache = new AnalysisCache();
