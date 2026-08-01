# XAUUSD Finage Analyzer — Phase 1 through Phase 7

A fresh Next.js application for one-click historical XAUUSD analysis using the Finage Forex Aggregates API.

This release intentionally has:

- no PostgreSQL
- no Prisma
- no permanent WebSocket worker
- no trading strategy
- no automatic order execution
- no future-candle lookahead

The app fetches historical M1 candles on demand, validates and aggregates them, keeps the full dataset only in an expiring server-memory cache, and sends selected chart windows to the browser. Phase 2 measures individual candle structure. Phase 3 measures how price travels across candles. Phase 4 synchronizes 1D, rolling 5H, 1H, 15M, 5M and 1M responsibilities. Phase 5 ranks bullish, bearish and range hypotheses and evaluates four opportunity families. Phase 6 converts qualified opportunities into a closed-candle decision lifecycle. Phase 7 then creates or rejects an analytical entry, stop and target plan using structural risk, historical target space, configured execution-cost assumptions, no-chase and expiry controls. Live broker execution remains unavailable.

## Architecture

```text
Browser
  ├─ POST /api/market/analyze
  │    └─ Finage M1 fetch
  │       → validation and gap audit
  │       → M5/M15/H1/D1 aggregation
  │       → candle-behaviour summaries
  │       → price-behaviour summaries
  │       → synchronized multi-timeframe market-state summary
  │       → hypothesis and opportunity summary
  │       → signal-decision lifecycle summary
  │       → entry/target/risk qualification summary
  │       → temporary in-memory analysis cache
  │
  ├─ GET /api/market/window
  │    └─ selected 500–5,000 candle window
  │       + compact candle-behaviour DTO
  │       + compact price-behaviour DTO
  │       + market state at the window's final closed candle
  │       + hypothesis/opportunity snapshot at the same anchor
  │       + signal-decision snapshot at the same anchor
  │       + Phase 7 trade plan at the same anchor
  │
  ├─ GET /api/market/state
  │    └─ synchronized Phase 4 state at an arbitrary historical timestamp
  │
  ├─ GET /api/market/opportunities
  │    └─ Phase 5 hypotheses and opportunity candidates at an arbitrary timestamp
  │
  ├─ GET /api/market/signals
  │    └─ Phase 6 lifecycle decision at an arbitrary historical timestamp
  │
  ├─ GET /api/market/signals/history
  │    └─ paginated confirmed, continuation and invalidation events
  │
  ├─ GET /api/market/trades
  │    └─ Phase 7 plan at an arbitrary historical timestamp
  │
  ├─ GET /api/market/trades/history
  │    └─ paginated analytical trade plans and outcomes
  │
  ├─ GET /api/market/trades/export
  │    └─ backpressure-aware streamed trade-plan CSV or JSON
  │
  └─ GET /api/market/export
       └─ streamed timeframe candle CSV or JSON
```

## Deployment constraint

The analysis cache lives in process memory. Run this version as one long-running Next.js Node process on a VPS, Docker host, Railway service, Render web service, or similar single-instance environment.

Do not deploy this exact cache architecture across multiple stateless instances unless sticky routing or an external shared cache is added.

## Phase 1 — Market data foundation

- Finage date chunks below the configured result limit
- bounded request concurrency
- transient retry and timeout handling
- runtime response validation
- exact `[from,to)` filtering
- OHLC validation, sorting and deduplication
- DST-aware New York weekend closure classification
- missing tradable intervals separated from expected closure
- M5, M15, H1 and configurable D1 aggregation
- explicit completeness metadata
- request-boundary partial candles separated from provider failures
- rolling latest 300-minute snapshot
- expiring server-side LRU cache
- maximum 5K browser window by default
- backpressure-aware streamed CSV and JSON export

## Phase 2 — Candle behaviour

For each candle, using only current and prior candles:

- direction, range, body and wicks
- body/range and close location
- range/body versus previous-20 average
- adjacent overlap
- wick break versus body-close break
- 1/3/5/10/20 comparisons
- inside/outside bar
- range expansion/compression
- displacement candidate
- rejection and wick sweep
- indecision and exhaustion candidate
- intensity score and strongest-event summary

## Phase 3 — Price behaviour

For every supported timeframe:

- 3/5/10/20-bar net progress
- gross close-to-close travel
- directional efficiency
- speed per candle
- overlap and direction-alternation noise
- recent-range regime ratio
- balanced, noisy, compression and expansion phases
- objective impulse state machine
- impulse direction, strength, age and extension
- pullback depth and duration
- recovery speed ratio
- bullish/bearish impulse, pullback and recovery phases
- 5/10/20 rolling break levels
- break attempt, acceptance and failure
- momentum acceleration, steadiness and decay
- freshness score
- low/medium/high late-entry risk

These are measurements, not trade signals.

## Phase 3 optimization

- prefix sums for O(1) rolling progress/noise queries
- monotonic deques for O(n) rolling highs/lows
- typed arrays to limit allocation and garbage collection
- finite-state machines for impulse/pullback/recovery and break lifecycle
- bounded 80-candle context for server windows
- fixed-size min heap for strongest events
- no full Phase 3 feature array retained while producing summaries

Detailed definitions are in `PHASE3_ENGINE_SPEC.md`.


## Phase 4 — Multi-timeframe market state

For every closed M1 anchor:

- 1D environment condition, direction, strength, prior-20 range position and maturity
- rolling 5H campaign from the previous 300 clock minutes
- 1H location inside or outside the previous 20-hour range
- 15M pressure, correction, acceptance, failure, compression, expansion or rotation narrative
- 5M construction context without `READY`, `BUY` or `SELL` labels
- 1M execution context without entry permission
- weighted alignment and disagreement classification
- composite trend, correction, rotation, expansion, compression, range, noise or transition state

Higher-timeframe layers are eligible only after their candle closes. Incomplete current candles are displayed as `PARTIAL` and excluded from alignment instead of being silently replaced by an older state.

The evidence score is directional coherence, not probability or expected win rate.

Detailed definitions are in `PHASE4_ENGINE_SPEC.md`.

## Phase 4 optimization

- O(N) forward-pointer synchronization across all timeframes
- O(N) prefix sums and rolling campaign preparation
- O(N) monotonic rolling highs and lows
- O(N) two-pointer 15/60/300-minute window starts
- O(log N) arbitrary historical state lookup
- typed arrays for campaign calculations
- fixed-size min heap for strongest states
- WeakMap state-index cache attached to the in-memory dataset lifecycle
- candle-budget LRU eviction prevents multiple large analyses from exceeding the configured cache budget
- one Phase 4 snapshot per browser window instead of 100K browser snapshots


## Phase 5 — Hypothesis and opportunity engine

For every closed M1 anchor:

- bullish, bearish and range hypotheses are scored independently
- support and contradiction evidence remains visible
- only a sufficiently strong and separated hypothesis becomes `LEADING`
- Pressure Release, Failed Break Reversal, Impulse Reload and Timeframe Rotation are evaluated
- every candidate receives context, development, trigger and freshness sub-scores
- noise, destructive conflict, partial data, extension and late-entry risk act as blockers
- stages are `ABSENT`, `WATCH`, `DEVELOPING`, `MATURE_CANDIDATE` or `DEGRADED`

`MATURE_CANDIDATE` is not a trade signal. It only means Phase 6 may evaluate the candidate.

Detailed definitions are in `PHASE5_ENGINE_SPEC.md`.

## Phase 5 optimization

- Phase 4 and Phase 5 summaries run in one synchronized O(N) pass
- fixed-size min heaps retain only strongest states and candidates
- WeakMap index reuse avoids rebuilding synchronized higher-timeframe structures
- arbitrary timestamp lookup remains binary-search based
- browser receives one Phase 5 snapshot for the selected window, not 100K snapshots


## Phase 6 — Signal decision lifecycle

For each closed M1 anchor and each Phase 5 opportunity family:

- independent OBSERVING/WATCH/ARMED/CONFIRMED/CONTINUATION/INVALIDATED/NO_TRADE state
- family-specific trigger validation
- hypothesis support and ranking-gap checks
- strict fast-track rule for genuinely fast mature candidates
- duplicate confirmation suppression
- candidate grace, WATCH expiry and ARMED expiry
- same-direction continuation detection after pullback/rotation
- direction-flip, opposite-hypothesis and degradation invalidation
- structured no-trade reasons
- BUY/SELL/NONE decision labels

A confirmed Phase 6 decision is still not execution permission. Phase 7 now creates or rejects the analytical trade plan; live broker execution remains unavailable.

Detailed definitions are in `PHASE6_ENGINE_SPEC.md`.

## Phase 6 optimization

- Phase 4, Phase 5 and Phase 6 run in one synchronized O(N) pass
- four fixed state machines avoid dynamic candidate collections
- typed arrays retain compact historical lifecycle state
- O(log N) arbitrary timestamp lookup
- fixed-size min heap retains strongest signal events only
- browser receives one window-end decision snapshot instead of 100K signal objects


## Phase 7 — Entry, target, risk and trade management

For each new Phase 6 confirmation or continuation:

- family-specific entry zone and preferred price
- entry cannot fill inside the already-closed signal candle
- no-chase limit and exact expiry
- protected-structure invalidation and buffered stop loss
- user-configured spread and slippage assumptions
- cost-adjusted total risk and net R:R
- strictly prior, complete M1/M5/M15/H1 swing obstacle detection
- M15/H1 range-boundary target levels that existed before the signal candle
- expected 10-minute movement capacity caps target space; no automatic 3R is invented
- TP1, TP2 and optional TP3
- expected five- and ten-minute movement distance
- entry-fill, actual filled-risk/R:R, MFE and MAE tracking
- conservative entry-candle excursion handling
- healthy, stalled, weakening and target-progress states
- break-even protective stop after TP1
- TP1 trailing stop after TP2
- explicit entry/stop/target/no-chase intrabar ambiguity rejection
- hard rejection reasons separated from historical/live-execution limitations
- position sizing blocked without broker contract and account-risk inputs
- backpressure-aware full trade-plan CSV/JSON export

The output semantics are `ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION`.

## Phase 7 optimization

- existing Phase 6 index reused
- one O(N) price-behaviour traversal
- four fixed runtime tracks
- Int32 plan identifiers and Uint8 status/health arrays
- Float32 MFE/MAE/R-progress arrays
- rich objects created only for actual signal plans
- 300-candle obstacle scan only when a new plan is created
- one window-end Phase 7 snapshot sent to the browser

Detailed definitions are in `PHASE7_ENGINE_SPEC.md`.

## Setup

```bash
cp .env.example .env.local
# Add the real FINAGE_API_KEY
npm install
npm run verify:finage -- --from=2026-07-25 --to=2026-08-01 --limit=50000
npm run dev
```

Open:

```text
http://localhost:3000
```


## Finage request compatibility

The default request intentionally matches Finage's documented provider-default shape:

```text
/agg/forex/XAUUSD/1/minute/FROM/TO?apikey=<SERVER_KEY>&limit=50000
```

`sort` and `date_format` are not forced unless explicitly configured. The client accepts both timestamp and datetime `t` values, numeric or numeric-string OHLCV fields, and surfaces Finage error envelopes even when the provider returns HTTP 200.

Use only the key value in `.env.local`:

```env
FINAGE_API_KEY=your_key_value
```

Do not paste the full URL or `apikey=` into `FINAGE_API_KEY`.

## Environment

```env
FINAGE_API_KEY=replace_with_your_finage_api_key
FINAGE_REST_BASE_URL=https://api.finage.co.uk
FINAGE_XAUUSD_SYMBOL=XAUUSD
FINAGE_REQUEST_TIMEOUT_MS=30000
FINAGE_FETCH_CONCURRENCY=2
FINAGE_SORT=provider_default
FINAGE_DATE_FORMAT=provider_default
FINAGE_MAX_RESULTS_PER_REQUEST=50000
APP_MAX_CANDLES=100000
APP_MAX_WINDOW_CANDLES=5000
ANALYSIS_CACHE_TTL_MINUTES=30
ANALYSIS_CACHE_MAX_ENTRIES=3
ANALYSIS_CACHE_MAX_TOTAL_CANDLES=200000

FOREX_WEEKEND_MODE=NEW_YORK_17
FOREX_FRIDAY_CLOSE_UTC_HOUR=22
FOREX_SUNDAY_OPEN_UTC_HOUR=22

DAILY_BOUNDARY_MODE=NEW_YORK_17
```

The fixed UTC close/open values are used only when `FOREX_WEEKEND_MODE=FIXED_UTC`.

## Commands

```bash
npm run verify:finage
npm run typecheck
npm run test
npm run verify:phase3
npm run verify:phase4
npm run verify:phase5
npm run verify:phase6
npm run verify:phase7
npm run benchmark:100k
npm run benchmark:browser
npm run build
npm run verify:release
npm start
```

## Important semantics

- API interval is exactly `[from,to)`
- default weekend logic follows New York 17:00 and handles DST
- default D1 candle starts at New York 17:00
- valid boundary/closure partial candles do not inflate provider failure counts
- Phase 2 through Phase 7 never read a future candle
- Phase 7 target obstacles exclude every higher-timeframe candle that contains the signal M1 candle
- qualified plans keep hard rejection reasons separate from analytical limitations
- every Phase 4 higher-timeframe layer is closed-candle synchronized
- current incomplete higher-timeframe states remain visible as partial and do not vote in alignment
- break acceptance requires persistence beyond a level
- minor breaks below the documented range-relative threshold are ignored
- all Phase 3 thresholds are fixed and documented
- full analysis expires after the configured cache TTL
- chart endpoints return at most the configured browser window

## Verification documents

- `PHASE1_RELEASE_CHECKLIST.md`
- `PHASE3_RELEASE_CHECKLIST.md`
- `PHASE3_ENGINE_SPEC.md`
- `PHASE4_RELEASE_CHECKLIST.md`
- `PHASE4_ENGINE_SPEC.md`
- `PHASE5_RELEASE_CHECKLIST.md`
- `PHASE5_ENGINE_SPEC.md`
- `PHASE6_RELEASE_CHECKLIST.md`
- `PHASE6_ENGINE_SPEC.md`
- `PHASE7_RELEASE_CHECKLIST.md`
- `PHASE7_ENGINE_SPEC.md`
- `IMPLEMENTATION_CHECKLIST.md`
- `VERIFICATION_REPORT.md`
- `BENCHMARK.md`

## Not implemented yet

These belong to later phases:

- lot sizing without broker/account specifications
- AI explanations
- live market feed
- automated trading

## Automatic complete reports

Every successful fetch immediately returns a report summary and then automatically loads the complete report from:

```text
GET /api/market/report?analysisId=<uuid>&format=json|md
```

The complete JSON contains all signal events, all Phase 7 plans, MFE/MAE, rejection reasons, family breakdown, quality data and engine settings. The browser keeps the latest six reports in current-tab memory and can download them as one comparison bundle. Refreshing the tab clears this temporary collection.

## Historical signal markers

Every chart window now includes all matching Phase 6 events. Chart controls can independently show or hide:

- confirmed BUY/SELL markers
- continuation markers
- invalidation markers
- latest Phase 7 entry/SL/TP levels

Markers are mapped to the displayed timeframe candle, so an M1 signal remains visible on M5, M15, H1 and D1 charts. Marker extraction scans only the chronological events relevant to the selected server window.

## Report verification

```bash
npm run verify:report-signals
```

See:

- `REPORT_SIGNAL_MARKERS_SPEC.md`
- `REPORT_SIGNAL_MARKERS_CHECKLIST.md`

## Responsive interface

The complete Phase 1–7 dashboard now adapts from 320px phones to wide desktop displays.

Implemented behaviour:

- one-column phone, two-column tablet, three-column laptop and four-column desktop analysis forms
- touch-friendly controls with a 44px minimum target
- horizontally scrollable timeframe tabs
- stacked signal-marker and report actions on narrow screens
- viewport-aware chart height, including short landscape screens
- responsive metric, hypothesis, opportunity, signal and trade-plan cards
- horizontal touch scrolling for the complete behaviour table
- sticky UTC timestamp column while inspecting wide table data
- safe-area page padding, keyboard focus states and reduced-motion support

Run the dependency-free responsive check:

```bash
npm run verify:responsive
```

See:

- `RESPONSIVE_AUDIT.md`
- `RESPONSIVE_RELEASE_CHECKLIST.md`
- `RESPONSIVE_VIEWPORT_AUDIT.json`
