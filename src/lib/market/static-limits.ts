/**
 * Runtime limits intentionally compiled into the application.
 *
 * Change values only in this file when the Finage plan or deployment capacity
 * changes. These limits do not depend on Vercel/local environment variables.
 */
export const STATIC_RUNTIME_LIMITS = Object.freeze({
  /** Maximum records requested from one Finage aggregate API call. */
  FINAGE_MAX_RESULTS_PER_REQUEST: 30_000,

  /** Maximum cleaned M1 candles retained for one analysis, including warm-up. */
  APP_MAX_CANDLES: 100_000,

  /** Maximum candles returned by a single chart/window API response. */
  APP_MAX_WINDOW_CANDLES: 5_000,
} as const);

export type StaticRuntimeLimits = typeof STATIC_RUNTIME_LIMITS;
