# Phase 6 — Signal Decision Lifecycle Engine

## Purpose

Phase 6 converts Phase 5 opportunity candidates into a deterministic closed-candle decision lifecycle. It does not place trades and it does not calculate target space, stop-loss, position size, spread/slippage viability or execution permission.

A `CONFIRMED` or `CONTINUATION` result means only that the observed market evidence passed the Phase 6 decision gates. Phase 7 may still reject the decision.

## Independent family tracks

The engine maintains one state machine for each Phase 5 opportunity family:

- Pressure Release
- Failed Break Reversal
- Impulse Reload
- Timeframe Rotation

Independent tracks prevent one family from overwriting or hiding another candidate at the same timestamp.

## Lifecycle states

- `OBSERVING` — no active candidate
- `WATCH` — context exists, but development/trigger is incomplete
- `ARMED` — development has persisted and confirmation can occur
- `CONFIRMED` — first qualified directional decision for the episode
- `CONTINUATION` — distinct same-direction opportunity after a prior confirmed decision
- `INVALIDATED` — active thesis failed, expired, flipped or became blocked
- `NO_TRADE` — candidate exists but mandatory safety/quality gates block it

## Confirmation gates

A candidate can confirm only when all mandatory gates pass:

1. Phase 5 stage is `MATURE_CANDIDATE`.
2. Candidate direction is bullish or bearish.
3. Candidate score meets the documented threshold.
4. Family-specific trigger evidence is present.
5. Severe blockers are absent.
6. Late-entry and extended-move blockers are absent.
7. M1 execution quality is not noisy or late.
8. M1/M5 late-entry risk is not high.
9. Directional hypothesis support is sufficient.
10. The candidate either persisted from a prior WATCH/ARMED state or passes the strict fast-track gate.

## Family-specific trigger rules

### Pressure Release

Requires accepted break evidence and accepted M1 or M5 behaviour.

### Failed Break Reversal

Requires a failed break and opposite recovery evidence.

### Impulse Reload

Requires a controlled pullback and recovery confirmation.

### Timeframe Rotation

Requires lower-timeframe rotation and M1 rotation in the candidate direction.

## Fast-track confirmation

A direct one-candle confirmation is allowed only when all of these are true:

- candidate score is at least 86
- trigger sub-score is at least 30
- freshness is at least 65
- M1 quality is clean
- normal confirmation gates pass

This preserves fast expansion opportunities without allowing every newly mature candidate to confirm immediately.

## Reversal and rotation exception

Failed Break Reversal and Timeframe Rotation may confirm before the new direction becomes the leading composite hypothesis when:

- the opportunity score is strong
- the directional hypothesis has minimum independent support
- the family-specific trigger is complete

Continuation-oriented families remain stricter.

## Duplicate suppression

Once a family/direction episode confirms:

- repeated mature candles keep the same confirmed state
- no new confirmation event is emitted on every candle
- the decision records `DUPLICATE_SUPPRESSED`
- a cooldown protects against immediate re-alerting after invalidation

## Continuation logic

A decision becomes `CONTINUATION` when:

- a prior same-direction confirmation exists
- the new episode is separated by the configured minimum bars
- it remains within the continuation lookback
- the current family represents reload/rotation or differs from the previous confirmed family
- all current confirmation gates pass

## Invalidation rules

An active track invalidates when any of the following occurs:

- candidate direction flips
- opposite hypothesis becomes decisively stronger
- candidate becomes degraded
- severe data/noise/conflict blockers appear
- late/extended conditions invalidate the opportunity
- the candidate disappears after its grace period
- WATCH or ARMED expiry is exceeded

## Expiry

- WATCH expiry: 12 M1 bars
- ARMED expiry: 7 M1 bars
- candidate grace: 1 M1 bar
- duplicate cooldown: 5 M1 bars

Expiry times are calculated from the known closed-candle grid, not by reading future candles.

## No-trade reasons

The engine records structured reasons:

- no opportunity
- partial data
- noisy market
- destructive timeframe conflict
- late entry
- extended move
- direction conflict
- missing trigger
- cooldown
- ambiguous hypotheses

## BUY/SELL semantics

- bullish `CONFIRMED` or `CONTINUATION` → `BUY`
- bearish `CONFIRMED` or `CONTINUATION` → `SELL`
- all other lifecycle states → `NONE`

BUY/SELL here is a decision label, not an order instruction.

## Data structures and complexity

For N M1 candles and four opportunity families:

- one O(N) synchronized traversal
- fixed four-track state machines
- compact typed arrays for lifecycle history
- O(log N) historical timestamp lookup
- fixed-size min heap for strongest signals
- no 100K rich signal objects stored or sent to the browser
- Phase 4, Phase 5 and Phase 6 summaries are generated during the same traversal

## Historical consistency

The engine is prefix-stable:

- a result at time T is identical whether computed from data ending at T or from a larger dataset containing future candles
- only closed M1 and already-closed higher-timeframe inputs participate

## API

```text
GET /api/market/signals?analysisId=<uuid>&timestampMs=<optional>
```

Returns the complete Phase 6 snapshot at the requested historical timestamp.
