/**
 * Runtime limits intentionally compiled into the application.
 *
 * Change values only in this file when the Finage plan or deployment capacity
 * changes. These limits do not depend on Vercel/local environment variables.
 */
export const STATIC_RUNTIME_LIMITS = Object.freeze({
  /**
   * Maximum records requested from one Finage M1 aggregate call.
   * One calendar day contains at most 1,440 one-minute bars. A 5,000-record
   * limit leaves safe provider headroom without requesting a large response.
   */
  FINAGE_MAX_RESULTS_PER_REQUEST: 5_000,

  /**
   * Each logical chunk contributes exactly one UTC date to the merged stream.
   */
  FINAGE_M1_CHUNK_CALENDAR_DAYS: 1,

  /**
   * Finage date ranges behave inconsistently when FROM and TO are identical.
   * Request the target date plus the following date, then retain only the
   * target date during normalization.
   */
  FINAGE_M1_REQUEST_CALENDAR_DAYS: 2,

  /** Smallest adaptive recovery chunk after a transient 5xx failure. */
  FINAGE_M1_MIN_CHUNK_CALENDAR_DAYS: 1,

  /** One-day provider calls cannot be split further by calendar date. */
  FINAGE_M1_MAX_SPLIT_DEPTH: 0,

  /** Parallel provider calls. Kept low to reduce 429/rate-limit pressure. */
  FINAGE_FETCH_CONCURRENCY: 2,

  /** Historical analysis is blocked below this visible M1 coverage. */
  MINIMUM_ANALYSIS_M1_COVERAGE_PERCENT: 98,

  /** Maximum cleaned M1 candles retained for one analysis, including warm-up. */
  APP_MAX_CANDLES: 100_000,

  /** Maximum candles returned by a single chart/window API response. */
  APP_MAX_WINDOW_CANDLES: 5_000,
} as const);

export type StaticRuntimeLimits = typeof STATIC_RUNTIME_LIMITS;
