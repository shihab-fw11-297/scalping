# Phase 4 — Multi-Timeframe Market State Engine

## Purpose

Phase 4 converts the objective Phase 1–3 measurements into synchronized timeframe responsibilities. It does not create a trade signal, entry, stop, target, probability or automatic decision.

Every Phase 4 snapshot is anchored to a closed M1 candle. A higher-timeframe candle is visible only when its interval is closed at that anchor. Incomplete higher-timeframe candles remain visible as `PARTIAL`, but they do not contribute to composite alignment.

## Six responsibilities

### 1D environment

Outputs:

- condition: bullish/bearish expansion, bullish/bearish trend, range, compression, noisy or transition
- measured direction
- evidence strength
- position inside the previous 20-day range
- recent volatility ratio
- maturity: fresh, developing, mature or extended

It describes the broad environment. It does not issue a directional instruction.

### Rolling 5H campaign

Calculated from the previous 300 clock minutes of M1 data using:

- net progress
- gross close-to-close travel
- directional efficiency
- rolling high and low
- recent 60-minute progress
- recent 15-minute recovery
- recent versus prior volatility
- actual candles present

Stages:

- bullish/bearish impulse
- bullish/bearish pullback
- bullish/bearish recovery
- bullish/bearish decay
- compression
- balance
- session reopen
- insufficient data

A Sunday/session reopen is not treated as a full five-hour campaign until enough M1 observations exist.

### 1H opportunity location

Outputs:

- position relative to the previous 20 completed H1 candles
- above range, range high, upper quartile, middle, lower quartile, range low or below range
- with-trend pullback, extension, correction, breakout/breakdown, range or transition location
- distance to both prior range boundaries in average H1 ranges
- location quality score

The score measures location quality only. It is not win probability.

### 15M narrative

States:

- bullish/bearish pressure
- bullish/bearish correction
- bullish/bearish break acceptance
- failed break
- compression
- expansion
- rotation
- noisy
- balanced

### 5M setup construction context

States:

- idle
- compression building
- bullish/bearish pressure
- bullish/bearish break attempt
- bullish/bearish acceptance
- bullish/bearish pullback
- bullish/bearish recovery
- failed break
- extended
- noisy

This describes construction quality. It is deliberately not named `READY`, `BUY`, `SELL` or `CONFIRMED`.

### 1M execution context

States:

- calm
- bullish/bearish ignition
- bullish/bearish continuation
- bullish/bearish pullback
- bullish/bearish recovery
- bullish/bearish break attempt
- bullish/bearish accepted break
- failed break
- extended
- noisy

Quality is `CLEAN`, `MIXED`, `LATE` or `NOISY`.

## Cross-timeframe alignment

Alignment labels:

- `FRESH_ALIGNMENT`
- `MATURE_ALIGNMENT`
- `PRODUCTIVE_DISAGREEMENT`
- `DESTRUCTIVE_DISAGREEMENT`
- `MIXED`
- `NEUTRAL`
- `INSUFFICIENT_DATA`

Timeframe weights:

- 1D: 25
- rolling 5H: 25
- 1H: 20
- 15M: 15
- 5M: 10
- 1M: 5

`evidenceScore` measures weighted directional coherence and measured layer strength. It must never be shown as expected win rate.

Composite states:

- trend continuation
- correction
- rotation
- expansion
- compression
- range
- noise
- transition
- insufficient data

## Closed-candle synchronization

At M1 anchor time `T`:

- M5 candle is eligible only when `M5.open + 5 minutes <= T`
- M15 candle is eligible only when `M15.open + 15 minutes <= T`
- H1 candle is eligible only when `H1.open + 60 minutes <= T`
- D1 uses the configured daily boundary and its next boundary as close time
- M1 uses the candle whose close is at or before `T`

No higher-timeframe state reads an open candle.

## Data quality

`COMPLETE` and `EXPECTED_MARKET_CLOSURE` candles are available layers.

Current candles with:

- missing data
- partial missing data
- request-boundary partial coverage
- boundary plus closure partial coverage
- overfull data

remain displayed as `PARTIAL` and are excluded from the alignment calculation. The engine never silently falls back to an older state and presents it as current.

## DSA and performance

- prefix sums for rolling gross travel and average range
- monotonic deques for rolling prior highs, lows and 300-minute extremes
- two-pointer time-window starts for 15, 60 and 300 minutes
- binary search for arbitrary historical snapshot lookup
- forward pointers for full-series closed-timeframe synchronization
- fixed-size min heap for strongest market-state events
- typed arrays for rolling numeric series
- WeakMap index cache keyed by the in-memory dataset
- no materialized 100K Phase 4 snapshot array

Complexity:

- index construction: O(N)
- full Phase 4 summary: O(N)
- arbitrary state lookup after index construction: O(log N + bounded Phase 3 context)
- strongest event storage: O(K), where K is fixed and small

## API/UI

- analysis response includes full-range state distribution and latest synchronized state
- every chart window includes the state at its final closed candle
- `GET /api/market/state` retrieves a synchronized state at an arbitrary timestamp
- JSON export includes Phase 4 summary and latest state
- dashboard shows all six layers, alignment, composite state and data availability

## Explicit exclusions

Phase 4 does not include:

- trade hypothesis selection
- opportunity families
- BUY/SELL signals
- entry, stop or target
- confidence probability
- risk management
- AI-generated explanation
