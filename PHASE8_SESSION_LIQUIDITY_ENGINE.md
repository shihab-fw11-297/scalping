# Phase 8 — Session, Liquidity and Market-Structure Engine

## Purpose

Phase 8 supplies the location and liquidity context that a visual-pattern strategy cannot provide by itself. The engine answers:

- Which XAUUSD execution session is active?
- Where are the completed previous-day and previous-week boundaries?
- What are the latest Asia, London and New York opening-range boundaries?
- Which confirmed M15/H1 swings and equal-high/equal-low clusters remain relevant?
- Was a level genuinely swept and reclaimed?
- Did a closed-candle BOS or MSS occur after the sweep?

All Phase 8 calculations are deterministic, closed-candle synchronized and no-lookahead.

## Reference levels

The liquidity map includes:

- Previous day high/low
- Previous completed trading week high/low
- Asia 00:00–06:00 UTC range
- London 07:00–10:00 Europe/London opening range
- New York 08:00–10:00 America/New_York opening range
- Confirmed M15 and H1 pivot swings
- M15 equal-high/equal-low clusters

The previous-week calculation uses the most recent completed Monday–Friday trading-week group before the current trading week. It does not use a rolling last-five-day approximation.

## Session handling

Range construction and execution classification are intentionally separate:

- Range windows build deterministic session liquidity references.
- Execution classification uses broader London and New York active periods.
- `Intl.DateTimeFormat` handles London and New York DST changes.
- London/New York overlap is classified explicitly.

## Sweep definition

A sweep is not a simple wick tag. A valid event requires:

1. An active liquidity level available before the current candle.
2. Price trading beyond that level.
3. A close/reclaim back through the level.
4. Minimum sweep quality.
5. Cooldown protection against repeatedly counting the same level.

Each event stores direction, level type, level price, excursion, reclaim status, session and score.

## Structure definition

The M1 structure layer uses confirmed pivots only. A structure shift requires a closed candle beyond the relevant swing.

- `BOS` represents continuation structure.
- `MSS` represents a directional change relative to the preceding structure.
- A strong BOS may support QML only when both structure and displacement scores are high.
- Weak intrabar pokes do not qualify.

## Data readiness

Phase 8 does not activate until it has baseline D1 and H1 context. The pipeline additionally fetches prior warm-up calendar days, removes expected market-closure/stale candles and builds higher timeframes from cleaned M1 data.

## Outputs

`SessionLiquiditySnapshot` exposes:

- Active session and market location
- Data-ready state
- PDH/PDL/PWH/PWL
- Asia/London/New York ranges
- Nearest liquidity above and below
- Latest sweep
- Latest BOS/MSS
- Current QML state

`SessionLiquiditySummary` exposes transition counts rather than counting a persisted state on every candle.

## No-lookahead guarantees

- M15/H1 pivots are usable only after the right-side pivot radius has closed.
- D1 references are usable only after their trading-day bucket closes.
- Previous-week references come only from a completed earlier week.
- Sweep and structure events use only the current and prior closed candles.
- Prefix replay is verified before Phase 9 confirmation.
