# Phase 3 Release Checklist

## A. Scope controls

- [x] No trading strategy added
- [x] No BUY/SELL signal added
- [x] No entry, stop-loss or take-profit logic added
- [x] No confidence or win-probability claim added
- [x] No future-candle lookahead
- [x] Phase 1 data-quality rules remain enforced
- [x] Phase 2 candle measurements remain independent

## B. Directional progress

- [x] 3-bar net progress
- [x] 5-bar net progress
- [x] 10-bar net progress
- [x] 20-bar net progress
- [x] 5-bar gross travel
- [x] 20-bar gross travel
- [x] 3/5/10/20 directional efficiency
- [x] 3/5/10/20 speed per candle
- [x] Bullish, bearish and neutral progress classification

## C. Noise and regime

- [x] Previous-candle overlap input
- [x] Five-candle average overlap
- [x] Five-candle direction-alternation rate
- [x] Composite noise score
- [x] Recent-range versus prior-20 range ratio
- [x] Compression classification
- [x] Expansion classification
- [x] Noisy classification
- [x] Balanced fallback classification

## D. Momentum

- [x] Current three-candle velocity
- [x] Previous three-candle velocity
- [x] Acceleration ratio
- [x] Direction-consistency validation
- [x] Steady bullish/bearish state
- [x] Accelerating bullish/bearish state
- [x] Decaying bullish/bearish state
- [x] Neutral state

## E. Impulse, pullback and recovery

- [x] Objective impulse qualification
- [x] Impulse direction
- [x] Impulse strength score
- [x] Impulse start and extreme tracking
- [x] Impulse age and expiry
- [x] Pullback start detection
- [x] Pullback extreme tracking
- [x] Pullback depth percentage
- [x] Pullback duration
- [x] Recovery start detection
- [x] Recovery speed ratio
- [x] Impulse invalidation
- [x] Bullish/bearish impulse phase
- [x] Bullish/bearish pullback phase
- [x] Bullish/bearish recovery phase
- [x] Momentum-decay phase

## F. Break acceptance and failure

- [x] Previous 5-bar high/low
- [x] Previous 10-bar high/low
- [x] Previous 20-bar high/low
- [x] Strongest broken lookback
- [x] Minimum meaningful break-distance filter
- [x] Bullish/bearish break attempt
- [x] Persistence requirement before acceptance
- [x] Bullish/bearish accepted break
- [x] Bullish/bearish failed break
- [x] Both-sides failed classification
- [x] Break level
- [x] Break lookback
- [x] Break age
- [x] Break-state expiry

## G. Freshness and lateness

- [x] Extension measured in previous-average-range units
- [x] Impulse-age freshness penalty
- [x] Momentum-decay freshness penalty
- [x] Pullback-depth freshness penalty
- [x] Extension freshness penalty
- [x] Recovery-speed freshness bonus
- [x] Freshness score clamped to 0–100
- [x] LOW late-entry risk
- [x] MEDIUM late-entry risk
- [x] HIGH late-entry risk
- [x] No active impulse does not create fake high risk

## H. DSA and performance

- [x] Prefix sums for constant-time rolling sums
- [x] Monotonic deque rolling extremes
- [x] Typed numeric arrays
- [x] Single-pass state-machine evaluation
- [x] Bounded 80-candle server-window context
- [x] Fixed-size min heap for strongest events
- [x] O(n) core price-behaviour processing
- [x] No full Phase 3 feature array retained for summaries
- [x] 100K-candle stress verification script
- [x] Browser receives only compact Phase 3 window DTOs

## I. API, export and dashboard

- [x] Phase 3 summary returned for every timeframe
- [x] Phase 3 compact fields returned by `/api/market/window`
- [x] Phase 3 summary and per-candle details included in backpressure-aware JSON export
- [x] Phase 3 details included in backpressure-aware streamed CSV export
- [x] Price-behaviour summary dashboard
- [x] Phase counts
- [x] Break-state counts
- [x] Strongest price events
- [x] Per-candle Phase 3 table fields
- [x] Late-entry risk visual classification

## J. Automated verification implemented

- [x] Efficient trend versus alternating-noise test
- [x] Compression test
- [x] Expansion test
- [x] Momentum acceleration test
- [x] Late-entry risk test
- [x] Impulse test
- [x] Pullback depth test
- [x] Recovery-speed test
- [x] Break-attempt test
- [x] Break-acceptance test
- [x] Wick-failure test
- [x] No-lookahead equality test
- [x] Bounded-window versus full-prefix equality test
- [x] Summary count test
- [x] 100K Phase 3 verification command
- [x] 100K full pipeline benchmark
- [x] Browser payload benchmark updated for Phase 3

## K. External runtime checks still required

- [ ] Install dependencies from a working npm registry
- [ ] Run `npm run typecheck`
- [ ] Run `npm run test`
- [ ] Run `npm run verify:phase3`
- [ ] Run `npm run benchmark:100k`
- [ ] Run `npm run benchmark:browser`
- [ ] Run `npm run build`
- [ ] Run `npm run verify:finage` with the real API key
- [ ] Run a real Chrome 100K-data interaction smoke test

## Release decision

Phase 3 implementation is complete at code level. It becomes runtime-verified only after every item in section K passes on the target machine.
