import {
  createSessionLiquidityIndex,
  sessionLiquidityAtIndex,
} from "../src/lib/market/session-liquidity";
import { classifyXauTradingSession, getSessionMembership } from "../src/lib/market/trading-session";
import { datasetsFrom, generateQmlFixture } from "./qml-fixture";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function utcWeekKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset));
  return monday.toISOString().slice(0, 10);
}

const summerOverlap = Date.UTC(2026, 6, 15, 13, 30);
invariant(classifyXauTradingSession(summerOverlap) === "LONDON_NEW_YORK_OVERLAP", "DST-aware London/New York overlap classification failed.");
const londonRangeMinute = Date.UTC(2026, 6, 15, 7, 30);
invariant(getSessionMembership(londonRangeMinute).active.LONDON, "London opening-range membership failed.");

const candles = generateQmlFixture(25_000);
const datasets = datasetsFrom(candles);
const index = createSessionLiquidityIndex(datasets, "NEW_YORK_17");
const summary = index.summary;

invariant(summary.dataReadySamples > 0, "Session/liquidity engine never reached data-ready state.");
invariant(summary.sweepCount > 0, "No meaningful liquidity sweeps were detected.");
invariant(summary.bosCount + summary.mssCount > 0, "No closed-candle BOS/MSS events were detected.");
invariant(summary.qmlWatchCount > 0, "QML watch stage never activated after a valid sweep.");
invariant(summary.sessionCounts.LONDON_NEW_YORK_OVERLAP > 0, "Overlap samples were not counted.");
invariant(index.sweepEvents.every((event) => event.reclaimed), "A non-reclaimed event leaked into liquidity sweeps.");

const previousWeekPairs = new Map<string, Set<string>>();
const samplesByWeek = new Map<string, number>();
for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
  const timestampMs = candles[candleIndex][0];
  const day = new Date(timestampMs).getUTCDay();
  if (day === 0 || day === 6) continue;
  const snapshot = sessionLiquidityAtIndex(index, candleIndex);
  if (!snapshot?.dataReady || snapshot.previousWeekHigh === null || snapshot.previousWeekLow === null) continue;
  const key = utcWeekKey(timestampMs);
  const pair = `${snapshot.previousWeekHigh.toFixed(5)}:${snapshot.previousWeekLow.toFixed(5)}`;
  const set = previousWeekPairs.get(key) ?? new Set<string>();
  set.add(pair);
  previousWeekPairs.set(key, set);
  samplesByWeek.set(key, (samplesByWeek.get(key) ?? 0) + 1);
}
const stableCompletedWeeks = [...previousWeekPairs.entries()].filter(([key, pairs]) => (samplesByWeek.get(key) ?? 0) >= 1_000 && pairs.size === 1);
invariant(stableCompletedWeeks.length >= 1, "Previous completed-week levels changed inside the same trading week.");

const latest = sessionLiquidityAtIndex(index, candles.length - 1);
invariant(latest !== null, "Latest session/liquidity snapshot is missing.");
invariant(latest.previousDayHigh !== null && latest.previousDayLow !== null, "Previous-day liquidity context is missing after warm-up.");
invariant(latest.previousWeekHigh !== null && latest.previousWeekLow !== null, "Previous completed trading-week liquidity context is missing after warm-up.");
invariant(latest.previousWeekHigh >= latest.previousWeekLow, "Previous-week high/low ordering is invalid.");

console.log(JSON.stringify({
  ok: true,
  sampleCount: summary.sampleCount,
  dataReadySamples: summary.dataReadySamples,
  sessionCounts: summary.sessionCounts,
  sweepCount: summary.sweepCount,
  bullishSweepCount: summary.bullishSweepCount,
  bearishSweepCount: summary.bearishSweepCount,
  bosCount: summary.bosCount,
  mssCount: summary.mssCount,
  qmlWatchCount: summary.qmlWatchCount,
}, null, 2));
