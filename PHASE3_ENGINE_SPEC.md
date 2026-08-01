# Phase 3 — Price Behaviour Engine Specification

Phase 3 measures how price travels. It does not generate trades, directions, entries, stops, targets, probabilities, or confidence claims.

## Inputs

- Sorted, validated OHLCV candles from Phase 1
- Phase 2 candle behaviour remains available independently
- Supported timeframes: M1, M5, M15, H1, D1
- Every calculation uses only the current candle and bounded historical candles

## Core measurements

### Directional progress

For 3, 5, 10 and 20 bars:

```text
Net progress = current close - historical close
Gross travel = sum(abs(close[i] - close[i-1]))
Efficiency = abs(net progress) / gross travel
Speed = abs(net progress) / elapsed candles
```

A clean directional path approaches 100% efficiency. Alternating movement approaches 0%.

### Noise score

The score combines:

- lack of 5-bar directional efficiency
- average adjacent-candle overlap
- close-direction alternation rate

```text
Noise = (1 - efficiency5) × 45
      + overlap5 × 35
      + alternation5 × 20
```

The score is clamped to 0–100.

### Range regime

```text
Range regime ratio = recent 3-candle average range / previous 20-candle average range
```

It supports compression and expansion classification without treating an indicator as a trade signal.

## Momentum

Recent three-candle velocity is compared with the preceding three-candle velocity.

- ratio ≥ 1.25 with directional efficiency: accelerating
- ratio ≤ 0.75 or direction changed: decaying
- otherwise: steady

Momentum states:

- NEUTRAL
- STEADY_BULLISH / STEADY_BEARISH
- ACCELERATING_BULLISH / ACCELERATING_BEARISH
- DECAYING_BULLISH / DECAYING_BEARISH

## Impulse state machine

An impulse requires all of the following:

- minimum move of 1.35 previous-average ranges
- 5-bar efficiency of at least 0.62
- at least 60% close changes in one direction
- recent average body strength of at least 0.45
- expansion, acceleration, or strong 3-bar efficiency

The state machine records:

- direction
- start index and start price
- extreme price and extreme index
- measured move
- strength score
- age

Impulse state expires after 40 candles or invalidates after a full structural retracement.

## Pullback and recovery

After a measured impulse:

```text
Pullback depth % = adverse distance from impulse extreme / impulse distance × 100
Pullback duration = candles from pullback start to pullback extreme
Recovery speed ratio = recovery distance per candle / pullback distance per candle
```

A ratio above 1 means recovery is travelling faster than the pullback. It is a measurement, not an entry instruction.

## Break acceptance state machine

Rolling previous highs and lows are maintained for 5, 10 and 20 bars using monotonic deques.

A break must exceed the level by at least 12% of the previous 20-candle average range. This prevents tiny floating-point or minor wick changes from becoming false break events.

States:

- NONE
- BULLISH_ATTEMPT / BEARISH_ATTEMPT
- BULLISH_ACCEPTED / BEARISH_ACCEPTED
- BULLISH_FAILED / BEARISH_FAILED
- BOTH_SIDES_FAILED

A body break begins as an attempt. A second close that remains beyond the level confirms acceptance. A close back through the level produces failure. The state expires after six candles.

## Market phases

- BALANCED
- NOISY
- COMPRESSION
- EXPANSION
- BULLISH_IMPULSE / BEARISH_IMPULSE
- BULLISH_PULLBACK / BEARISH_PULLBACK
- BULLISH_RECOVERY / BEARISH_RECOVERY
- MOMENTUM_DECAY

These are descriptive states and do not create BUY/SELL decisions.

## Freshness and late-entry risk

Freshness starts from the active impulse and decreases with:

- impulse age
- extension in average-range units
- momentum decay
- deep pullback

Recovery faster than pullback can add a small freshness bonus.

Late-entry risk:

- HIGH: extreme extension, low freshness, or decaying extended movement
- MEDIUM: moderate extension, moderate freshness, or deep pullback
- LOW: fresh and not materially extended

Without an active impulse, late-entry risk defaults to LOW rather than inventing an entry context.

## DSA and complexity

### Prefix sums — O(n)

Used for constant-time window queries of:

- gross close travel
- candle ranges
- body strength
- overlap
- direction alternation
- bullish/bearish change counts

### Monotonic deques — O(n)

Used for previous 5/10/20 rolling highs and lows. Every index enters and exits each deque once.

### Finite-state machines — O(n)

Used for:

- active impulse
- pullback
- recovery
- break attempt
- break acceptance
- break failure

### Bounded-context windowing — O(window + 80)

The browser asks for only the selected candle window. The server adds 80 historical candles internally, reconstructs state, and returns only the requested output.

### Fixed-size min heap — O(n log k)

Only the strongest `k` price-behaviour events are retained. The full event list is never sorted or stored.

### Typed arrays

Numeric working data uses `Float64Array`, `Int8Array`, `Int32Array`, and `Uint32Array` to reduce object allocation and garbage collection pressure.

## Non-negotiable limitations

- Historical OHLC cannot reveal the true tick sequence inside a candle.
- Phase 3 does not estimate target space.
- Phase 3 does not use future candles to confirm a past event.
- Phase 3 does not claim win probability.
- Thresholds are fixed, documented, and never automatically modified during analysis.
