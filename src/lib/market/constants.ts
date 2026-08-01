import type { CandleBehaviourTag, Timeframe } from "./types";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: MINUTE_MS,
  M5: 5 * MINUTE_MS,
  M15: 15 * MINUTE_MS,
  H1: 60 * MINUTE_MS,
  D1: DAY_MS,
};

export const EXPECTED_M1_CHILDREN: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  H1: 60,
  D1: 1440,
};

export const DERIVED_TIMEFRAMES = ["M5", "M15", "H1", "D1"] as const;
export const ALL_TIMEFRAMES = ["M1", "M5", "M15", "H1", "D1"] as const;

export const CANDLE_BEHAVIOUR_TAGS: readonly CandleBehaviourTag[] = [
  "NORMAL",
  "INSIDE_BAR",
  "OUTSIDE_BAR",
  "RANGE_EXPANSION",
  "RANGE_COMPRESSION",
  "BULLISH_DISPLACEMENT",
  "BEARISH_DISPLACEMENT",
  "UPPER_REJECTION",
  "LOWER_REJECTION",
  "WICK_SWEEP_HIGH",
  "WICK_SWEEP_LOW",
  "INDECISION",
  "EXHAUSTION_CANDIDATE",
] as const;
