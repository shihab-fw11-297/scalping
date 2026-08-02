# Phase 9 — Session Liquidity QML Reversal Engine

## Strategy identity

The implemented strategy is `SESSION_LIQUIDITY_QML`.

It is not a generic visual Quasimodo detector. A chart shape by itself cannot create a trade-ready signal. The strategy requires a complete market story:

```text
Meaningful liquidity location
→ sweep and reclaim
→ closed-candle MSS or exceptionally strong BOS
→ valid QML shoulder/head geometry
→ first or controlled second retest
→ opposite-side liquidity target
→ Phase 6 confirmation
→ Phase 7 A/B trade-quality permission
```

## State machine

The QML runtime moves through:

1. `NONE`
2. `LIQUIDITY_SWEPT`
3. `MSS_CONFIRMED`
4. `RETEST_WAIT`
5. `RETEST_CONFIRMED`
6. `INVALIDATED` or `EXPIRED`

A terminal state remains visible briefly for reporting and then resets.

## Medium-signal policy

The user requirement is signal availability without indiscriminate over-signalling. The implementation therefore uses a balanced policy:

- Minimum sweep score: 48
- MSS window: 10 M1 bars after sweep
- Retest window: 20 M1 bars after MSS
- Maximum retests: 2
- QML internal medium-ready score: 62
- Phase 6 QML confirmation minimum: 68
- Phase 7 Grade B minimum: 68
- Phase 7 Grade A minimum: 80
- Minimum cost-adjusted R:R remains 1.5

The first retest receives the highest score. A second retest is allowed only within the controlled QML window and is graded lower. A third retest expires the setup.

## Geometry

For bearish QML:

- Liquidity above price is swept and reclaimed.
- The head is the sweep extreme.
- A valid shoulder must be below the head and reasonably close to the swept area.
- Bearish MSS/BOS must follow the sweep.
- Invalidation is beyond the head plus a volatility buffer.

For bullish QML the geometry is mirrored.

When an old or geometrically invalid shoulder would place the QML zone far from the actual setup, the engine falls back to the swept level instead of producing an unrealistic entry.

## Target logic

Targets must be on the opposite directional liquidity side:

- Bullish QML seeks high-side liquidity.
- Bearish QML seeks low-side liquidity.
- Hard liquidity references are preferred.
- The target must remain beyond the post-MSS price.
- Expansion fallback is used only when no valid mapped level exists.

## Signal lifecycle integration

Phase 6 requires evidence for:

- `LIQUIDITY_SWEEP`
- `MARKET_STRUCTURE_SHIFT`
- `FIRST_RETEST` or `SECOND_RETEST`

QML can receive a measured hypothesis exception in range/unclear environments after the complete chain is present, but it cannot override a strong opposite hypothesis. It also cannot bypass severe blockers, noisy execution or missing trigger evidence. Because sweep → structure shift → closed retest already supplies multi-bar persistence, a valid mature QML chain fast-confirms on the retest close instead of waiting extra Phase 6 bars and creating an avoidably late signal.

## Phase 7 execution

Phase 7 derives:

- Entry zone from the QML level
- Structural stop from the head/invalidation
- Opposite-liquidity TP targets
- Spread/slippage-adjusted risk and R:R
- A/B/C/BLOCKED trade quality
- First/second-retest quality reasons
- Entry expiry and no-chase handling

Only Grade A/B plans appear in the default trading view. Pattern-confirmed/rejected events remain available in research mode.

## Duplicate control

Signals inside the same directional market episode are merged. The chart receives one primary A/B marker rather than separate Pressure Release, Failed Break, Rotation and QML markers for the same move.

## Chart and report integration

The optional Session/QML overlay displays:

- PWH/PWL
- PDH/PDL
- Asia high/low
- London high/low
- New York high/low
- QML level
- QML target

The report includes sweep, BOS, MSS, QML-watch, QML-confirmed, invalidated and expired counts plus the strongest QML setups.

## Safety and semantics

- This engine is analytical, not an order-routing system.
- Synthetic verification proves software behaviour, not XAUUSD profitability.
- Real accuracy requires resolved, non-overlapping Finage/paper-trade samples.
- No live-money deployment should occur before paper validation and drawdown/risk governance.
