# Implementation Checklist

## Phase 1 — Implemented

- [x] XAUUSD-only scope
- [x] Finage API key remains server-side
- [x] Historical M1 date chunking
- [x] Configurable request limit below 50K
- [x] Bounded request concurrency
- [x] Timeout and transient retry handling
- [x] Runtime provider response validation
- [x] Real-provider verification command
- [x] UTC timestamp normalization
- [x] Exact `[from,to)` interval handling
- [x] Invalid numeric/OHLC rejection
- [x] Out-of-order detection and conditional sort
- [x] Exact duplicate removal
- [x] Conflicting duplicate reporting
- [x] DST-aware New York weekend closure classification
- [x] Optional fixed-UTC closure classification
- [x] Tradable missing intervals reported separately
- [x] M5 aggregation
- [x] M15 aggregation
- [x] H1 aggregation
- [x] New York 17:00 or UTC-midnight D1 aggregation
- [x] Rolling latest 5H/300-minute snapshot
- [x] Explicit candle coverage object
- [x] Request-boundary partial classification
- [x] Expected-closure classification
- [x] Missing-data classification
- [x] Incomplete counts exclude valid boundary/closure candles
- [x] 100K server-side processing guard
- [x] Temporary TTL/LRU analysis cache
- [x] Total-candle cache budget with LRU eviction
- [x] Browser receives selected data windows only
- [x] Default browser window capped at 5K candles
- [x] Compact browser behaviour payload
- [x] Backpressure-aware streamed CSV export
- [x] Backpressure-aware streamed JSON export
- [x] Data-quality dashboard
- [x] Browser payload benchmark

## Phase 2 — Implemented

- [x] Candle direction
- [x] Candle range
- [x] Candle body
- [x] Upper/lower wick
- [x] Body-to-range ratio
- [x] Close location
- [x] Wick ratios
- [x] Range vs previous-20 average
- [x] Body vs previous-20 average
- [x] Previous-candle overlap
- [x] Previous high/low break detection
- [x] Wick break vs body-close break
- [x] 1/3/5/10/20-candle comparisons
- [x] Maximum high/low break lookback
- [x] Inside/outside bar
- [x] Range expansion/compression
- [x] Bullish/bearish displacement candidate
- [x] Upper/lower rejection
- [x] High/low wick sweep
- [x] Indecision
- [x] Exhaustion candidate
- [x] Behaviour intensity score
- [x] Per-timeframe behaviour summary
- [x] Fixed-size heap for strongest events
- [x] Three-way quickselect median/P90/P95
- [x] No future-candle lookahead
- [x] Behaviour CSV fields
- [x] Behaviour dashboard/table

## Phase 3 — Implemented

- [x] 3/5/10/20-bar net directional progress
- [x] Gross close-to-close travel
- [x] Directional efficiency
- [x] Speed per candle
- [x] Five-candle overlap average
- [x] Direction-alternation rate
- [x] Composite noise score
- [x] Recent-range regime ratio
- [x] Balanced/noisy/compression/expansion phases
- [x] Objective impulse qualification
- [x] Impulse direction, strength, age and extension
- [x] Pullback depth and duration
- [x] Recovery speed ratio
- [x] Bullish/bearish impulse, pullback and recovery phases
- [x] Previous 5/10/20 rolling highs/lows
- [x] Meaningful break-distance filter
- [x] Break attempt, acceptance and failure state machine
- [x] Momentum steady/acceleration/decay states
- [x] Freshness score
- [x] LOW/MEDIUM/HIGH late-entry risk
- [x] Prefix-sum rolling queries
- [x] Monotonic-deque rolling extremes
- [x] Typed-array working memory
- [x] Bounded 80-candle window context
- [x] Fixed-size heap strongest-event ranking
- [x] Per-timeframe Phase 3 summaries
- [x] Compact browser Phase 3 DTO
- [x] Streamed CSV Phase 3 fields
- [x] JSON Phase 3 summary
- [x] Price-behaviour dashboard and table
- [x] No-lookahead and window-context tests
- [x] 100K Phase 3 verification script

## Phase 4 — Implemented

- [x] synchronized closed-candle M1 anchor
- [x] 1D environment condition and direction
- [x] 1D range position and maturity
- [x] rolling 300-minute campaign direction and stage
- [x] session-reopen and insufficient-history handling
- [x] 1H prior-20 range location
- [x] 1H distance-to-boundary measurements
- [x] 15M pressure/correction/acceptance/rotation narrative
- [x] 5M construction-state classification
- [x] 1M execution-context classification
- [x] fresh/mature alignment
- [x] productive/destructive disagreement
- [x] composite trend/correction/rotation/expansion/compression/range/noise state
- [x] evidence coherence score clearly separated from probability
- [x] incomplete current higher timeframe exposed as `PARTIAL`
- [x] partial layers excluded from composite alignment
- [x] no stale-state substitution
- [x] binary-search historical state lookup
- [x] forward-pointer full-series synchronization
- [x] two-pointer 15/60/300-minute windows
- [x] monotonic rolling 5H high/low
- [x] typed-array campaign index
- [x] WeakMap index caching
- [x] bounded strongest-event heap
- [x] latest market-state response
- [x] chart-window-end market state
- [x] arbitrary timestamp state API
- [x] Phase 4 dashboard
- [x] JSON Phase 4 export metadata
- [x] no-lookahead synchronization tests
- [x] incomplete-data propagation test
- [x] 100K Phase 4 stress verification


## Phase 5 — Implemented

- [x] bullish, bearish and range hypotheses
- [x] independent support and contradiction scoring
- [x] evidence-code audit trail
- [x] dormant/weak/active/leading/conflicted hypothesis states
- [x] leading-score and ranking-gap requirement
- [x] Pressure Release candidate
- [x] Failed Break Reversal candidate
- [x] Impulse Reload candidate
- [x] Timeframe Rotation candidate
- [x] context/development/trigger/freshness sub-scores
- [x] deterministic direction mapping
- [x] absent/watch/developing/mature/degraded stages
- [x] noise, destructive conflict and partial-data blockers
- [x] high-late-risk and extension blockers
- [x] stage-first best-candidate ranking
- [x] combined Phase 4 + Phase 5 O(N) summary traversal
- [x] fixed-size strongest-opportunity heap
- [x] WeakMap Phase 5 index reuse
- [x] binary-search historical lookup
- [x] latest and chart-window-end snapshot
- [x] arbitrary timestamp opportunity API
- [x] Phase 5 dashboard
- [x] JSON summary export
- [x] no-lookahead prefix equality
- [x] Phase 3 and Phase 4 regression verification
- [x] 100K Phase 5 stress verification

## Phase 6 — Implemented

- [x] independent signal track per opportunity family
- [x] OBSERVING/WATCH/ARMED lifecycle
- [x] CONFIRMED directional decision
- [x] CONTINUATION directional decision
- [x] INVALIDATED lifecycle
- [x] NO_TRADE lifecycle
- [x] BUY/SELL/NONE decision labels
- [x] candidate persistence requirement
- [x] strict fast-track confirmation
- [x] family-specific trigger validation
- [x] directional-hypothesis support gate
- [x] reversal/rotation hypothesis exception
- [x] clean-execution and freshness gates
- [x] partial/noisy/conflict blockers
- [x] late and extended-move blockers
- [x] ambiguous-hypothesis blocker
- [x] candidate grace period
- [x] WATCH and ARMED expiry
- [x] duplicate alert suppression
- [x] family/direction cooldown
- [x] direction-flip invalidation
- [x] opposite-hypothesis invalidation
- [x] candidate degradation/disappearance invalidation
- [x] continuation separation and lookback
- [x] structured reasons and no-trade reasons
- [x] typed-array signal index
- [x] Phase 4/5/6 shared O(N) traversal
- [x] latest and window-end signal snapshot
- [x] arbitrary timestamp signal API
- [x] paginated signal-event history API
- [x] recent decision-event summary
- [x] signal-decision dashboard
- [x] JSON export metadata
- [x] lifecycle summary and strongest-event heap
- [x] deterministic lifecycle simulation helper
- [x] prefix no-lookahead equality
- [x] 100K Phase 6 verification

## Phase 7 — Implemented

- [x] Phase 6 CONFIRMED/CONTINUATION input only
- [x] Family-specific entry models
- [x] Entry-zone lower/upper/preferred prices
- [x] No entry fill inside the closed signal candle
- [x] No-chase price and family-specific expiry
- [x] Structural protected high/low
- [x] Complete structural lookback requirement
- [x] Safety-buffered stop loss
- [x] Raw and cost-adjusted risk
- [x] User-configured spread/slippage assumptions
- [x] User-configured minimum net R:R
- [x] User-configured maximum stop width
- [x] Prior-only M1/M5/M15/H1 swing-obstacle detection
- [x] M15/H1 range-boundary detection
- [x] Signal-containing HTF candle excluded from prior obstacle set
- [x] Expected-10-minute capacity target-space cap
- [x] No forced 3R fallback
- [x] Complete-candle obstacle filtering
- [x] Target-space qualification
- [x] TP1/TP2/TP3 construction
- [x] Five- and ten-minute movement estimates
- [x] Entry-fill, MFE and MAE tracking
- [x] Actual filled-entry risk and R:R metrics
- [x] Entry-candle pre-fill extremes excluded
- [x] WAIT_ENTRY/ENTRY_VALID/ACTIVE lifecycle
- [x] TARGET1_HIT/TARGET2_HIT/COMPLETED lifecycle
- [x] EXPIRED/INVALIDATED/REJECTED lifecycle
- [x] Intrabar-order ambiguity rejection
- [x] Entry/no-chase same-candle ambiguity
- [x] Pre-entry structural-stop touch invalidation
- [x] Trade-health classification
- [x] Break-even stop after TP1
- [x] TP1 trailing stop after TP2
- [x] Superseded plan invalidation
- [x] Position-size refusal without broker/account inputs
- [x] Hard rejection reasons separated from analytical limitations
- [x] Compact plan-id/status/health typed arrays
- [x] Rich objects only for actual plans
- [x] Historical timestamp lookup API
- [x] Paginated plan-history API
- [x] Backpressure-aware trade-plan CSV/JSON export API
- [x] Window-end Phase 7 snapshot
- [x] JSON export metadata
- [x] Dashboard and chart price lines
- [x] Full/prefix no-lookahead equality
- [x] 100K stress benchmark
- [x] Phase 3–6 regression verification

## Runtime verification still required

- [ ] Real Finage API key verification
- [ ] Finage plan depth verification
- [ ] Full npm dependency installation
- [ ] Full Vitest execution
- [ ] Full Next.js production build
- [ ] Real-browser 100K interaction smoke test

- [ ] Broker-specific spread/slippage comparison


## Finage fetch compatibility fix — Implemented

- [x] Provider-default request matches `/agg/forex/{symbol}/1/minute/{from}/{to}`
- [x] Default query contains only `apikey` and `limit=50000`
- [x] `sort` is optional and not forced by default
- [x] `date_format` is optional and not forced by default
- [x] Numeric-string OHLCV values are safely coerced
- [x] Numeric-string `totalResults` is supported
- [x] Timestamp and datetime `t` values are supported
- [x] HTTP-200 Finage error envelopes become server errors
- [x] Empty and non-JSON provider responses have explicit diagnostics
- [x] API key is masked in verification output
- [x] Complete URL accidentally placed in `FINAGE_API_KEY` is rejected
- [x] Explicit-range verification CLI supports `--from`, `--to`, and `--limit`
- [x] Exact URL builder runtime assertion passed
- [x] API key is not stored in the project archive

## Automatic Reports and Chart Signal Markers — Implemented

- [x] Per-fetch complete report summary
- [x] Automatic full-report loading after analysis
- [x] Complete JSON report
- [x] Readable Markdown report
- [x] All Phase 6 events included
- [x] All Phase 7 plans included
- [x] Family comparison breakdown
- [x] Diagnostic flags
- [x] Flat comparison metrics
- [x] Six-report browser-session collection
- [x] One-click six-report bundle
- [x] Windowed historical chart markers
- [x] Confirmed/continuation/invalidation toggles
- [x] Show-all/hide-all controls
- [x] M1-to-higher-timeframe marker alignment
- [x] Binary-search event-window extraction
- [x] Report and marker verification script

## Full responsive interface — Implemented

- [x] 320px phone support
- [x] 375px and 430px phone support
- [x] 768px tablet support
- [x] Short landscape mobile support
- [x] 1024px laptop support
- [x] 1440px desktop support
- [x] 1920px wide-desktop support
- [x] Safe-area-aware outer spacing
- [x] No root-level horizontal overflow in audited viewports
- [x] Responsive analysis form columns
- [x] Minimum 44px touch targets
- [x] Keyboard-visible focus outlines
- [x] Responsive metric and state grids
- [x] Responsive report cards and collection controls
- [x] Horizontally scrollable timeframe tabs
- [x] Responsive signal-marker toggles
- [x] Responsive range controls
- [x] Viewport-aware chart height
- [x] Dedicated short-landscape chart rule
- [x] Horizontally scrollable full behaviour table
- [x] Sticky UTC table column
- [x] Mobile table swipe guidance
- [x] Keyboard-accessible labelled table region
- [x] Reduced-motion preference support
- [x] Dependency-free responsive verification command
- [x] Chromium viewport audit recorded in JSON

## Vercel serverless report/timeframe correction

- [x] Complete report generated inside `/api/market/analyze`
- [x] Complete report embedded in `AnalyzeMarketResponse`
- [x] Client-side JSON/Markdown report downloads
- [x] No mandatory second report request after fetch
- [x] Validated analysis recovery descriptor
- [x] Window cache miss rebuild from Finage
- [x] Recovery support for report/export/state/opportunity/signal/trade routes
- [x] Browser cache for loaded timeframe windows
- [x] Stale timeframe response suppression
- [x] Visible timeframe loading state
- [x] Visible serverless recovery state
- [x] Specific JSON recovery failure message
- [x] Static serverless route audit
- [x] Injected cache-miss recovery test

## Medium Accuracy V1

- [x] Automatic prior-context warm-up
- [x] Closed-market provider candle removal
- [x] Conservative stale-quote removal
- [x] Gap-adjacent safety blocking
- [x] Soft/medium/hard obstacle hierarchy
- [x] Independent A/B/C trade-quality grading
- [x] Timeframe Rotation changed to context-only
- [x] Multi-family market-episode deduplication
- [x] Default A/B-only chart markers
- [x] Optional research markers
- [x] Medium-accuracy report diagnostics
- [x] Deterministic and regression verification
- [ ] Real-market A/B calibration after resolved Finage samples

## Medium Accuracy V1 — Implemented

- [x] Phase 6 research markers separated from trade-ready markers
- [x] Grade A/B/C/BLOCKED trade quality
- [x] Medium threshold at 68 and Grade A threshold at 80
- [x] Quality score capped at 100
- [x] Regime, location, alignment, timing, target and session scoring
- [x] Timeframe Rotation changed to confluence-only
- [x] M1 soft / M5 medium / M15-H1 hard obstacle hierarchy
- [x] Only hard obstacles can veto target space
- [x] Same-market-episode signal merging
- [x] Opposite-direction conflict suppression
- [x] Default chart shows A/B only
- [x] Optional research view for Phase 6 events
- [x] Closed-market candle removal
- [x] Conservative stale-provider quote removal
- [x] Post-gap M1 safety marking
- [x] Gap-safety propagation to M5/M15/H1/D1 completeness
- [x] Automatic prior warm-up context
- [x] Warm-up excluded from chart/report totals
- [x] Serverless timeframe recovery retains warm-up/profile settings
- [x] A/B grade metrics in reports and UI
- [x] Obstacle classes and quality fields in CSV/JSON export
- [x] Deterministic medium-profile verification script

## Phase 8 — Session, Liquidity and Market Structure

- [x] DST-aware Asia, London and New York session clocks
- [x] London/New York overlap state
- [x] Previous-day high/low
- [x] Previous completed trading-week high/low
- [x] Asia, London and New York opening ranges
- [x] Confirmed M15/H1 swing liquidity
- [x] Equal-high/equal-low clusters
- [x] Sweep requires reclaim
- [x] Repeated sweep cooldown
- [x] Closed-candle BOS/MSS
- [x] Data-ready gating
- [x] No-lookahead pivot availability
- [x] Session/liquidity report summary
- [x] Session/liquidity UI panel

## Phase 9 — Session Liquidity QML

- [x] Contextual QML family added to Phase 5–7
- [x] Sweep → MSS → retest state machine
- [x] Original sweep preserved until structure confirmation
- [x] Shoulder/head geometry validation
- [x] Invalid shoulder fallback to swept level
- [x] First retest preferred
- [x] Controlled second retest permitted
- [x] Third retest expiry
- [x] Head-based structural invalidation
- [x] Opposite-liquidity targets
- [x] Medium internal and Phase 6 thresholds
- [x] Grade A/B Phase 7 permission
- [x] Market-episode deduplication
- [x] QML chart marker labels
- [x] Session/QML chart level toggle
- [x] Bullish and bearish deterministic verification
- [x] Prefix no-lookahead verification
- [ ] Real Finage calibration after new reports
- [ ] Paper execution and risk-governance validation
