# Phase 7 — Entry, Target, Risk and Trade Management Engine

## Purpose

Phase 7 consumes only Phase 6 `CONFIRMED` and `CONTINUATION` decisions. It may qualify or reject them after measuring entry location, structural invalidation, execution-cost assumptions, target space, net risk-reward, no-chase distance and expiry.

It produces an analytical trade plan. It does not place an order and does not claim live broker execution permission.

## User-configured assumptions

Each analysis request includes:

- assumed spread in XAUUSD price units
- assumed slippage in XAUUSD price units
- minimum net risk-reward
- maximum structural-stop distance in recent average ranges

Defaults are 0.25 spread, 0.10 slippage, 1.5 minimum R:R and 3.5 average ranges maximum stop. They remain visible in the response and are never represented as live measurements.

## Family-specific entry construction

### Pressure Release

Uses the accepted-break level when available. The entry zone is centered around that level and remains valid for two closed M1 bars.

### Failed Break Reversal

Uses the reclaim/recovery close with a three-bar validity window. Structural invalidation is beyond the failed-break side.

### Impulse Reload

Uses the midpoint between the measured pullback extreme and the recovery close. It receives a four-bar validity window.

### Timeframe Rotation

Uses the lower-timeframe rotation close, adjusted slightly toward the correction side, with a three-bar validity window.

No family uses a universal `signal close = exact entry` rule.

## Entry semantics

A signal candle is already closed, so Phase 7 never records an entry fill inside that candle. The earliest fill can occur on the next M1 candle when its OHLC range intersects the entry zone.

Statuses before entry:

- `WAIT_ENTRY`
- `ENTRY_VALID`
- `EXPIRED`
- `INVALIDATED`
- `REJECTED`

A no-chase price and exact expiry timestamp are included in every qualified plan.

## Structural invalidation

The protected high/low lookback depends on the opportunity family. A recent-average-range buffer is placed beyond the protected extreme.

The plan exposes:

- structural invalidation price
- initial stop-loss price
- safety buffer
- planned raw stop distance
- configured execution cost
- planned total risk including costs
- risk expressed in recent average ranges
- actual fill price when entered
- actual risk distance, cost-adjusted risk and actual TP1 R:R after the fill

Plans are rejected when the stop is structurally invalid, too narrow or wider than the configured maximum.

## Historical target space

Only complete candles already closed by the signal timestamp are considered. The engine evaluates:

- up to 300 prior M1 candles
- closed M5, M15 and H1 swing levels
- prior 20-candle M15 and H1 range boundaries

A swing candidate and its two neighbours on each side must all be complete. The nearest valid obstacle is compared with the expected ten-minute movement capacity; the smaller distance becomes the available target space. If no prior obstacle exists, the expected ten-minute capacity becomes the explicit limiting factor and the obstacle remains `null`.

## Net risk-reward

For target distance `D`, raw stop distance `R`, and assumed execution cost `C`:

```text
net reward = D - C
net risk   = R + C
net R:R    = net reward / net risk
```

TP1 is constructed so its net R:R meets the configured minimum. Target-space qualification also uses net R:R, not gross distance.

Targets:

- TP1 — minimum qualified net R:R
- TP2 — prior swing or bounded expansion objective
- TP3 — only when at least 3R of measured space exists

## Expected movement

The engine calculates deterministic, non-probabilistic estimates for:

- expected five-minute distance
- expected ten-minute distance
- expected bars until first progress
- LOW/MEDIUM/HIGH measurement confidence

Inputs are prior average range, speed, efficiency and noise. Future excursion is never used to create these estimates.

## Entry and outcome simulation

After the signal:

1. Entry is evaluated only on later closed candles.
2. Expiry, no-chase and structural invalidation are checked before entry.
3. A pre-entry stop touch invalidates the plan even when the candle later closes back above/below it.
4. When entry-zone and stop, target or no-chase levels coexist inside one OHLC candle, the ordering is marked ambiguous.
5. Entry-candle extremes are not used for MFE/MAE because they may have happened before the fill. MFE/MAE begins with the next fully known candle.
6. TP1, TP2 and TP3 progression is tracked.

## Intrabar ambiguity

OHLC does not reveal the order of high and low inside a candle. If one candle can both fill the entry and hit the stop/target, or can hit a protective stop and a target, the plan becomes:

```text
AMBIGUOUS_INTRABAR
```

The engine does not choose the favourable ordering.

## Protective-stop management

- Before TP1: original structural stop
- After TP1: analytical protective stop moves to entry/break-even
- After TP2: analytical protective stop trails to TP1

The snapshot exposes the current protective stop and management action. These are historical analytical instructions, not broker orders.

## Trade health

After entry:

- `HEALTHY`
- `STALLED`
- `WEAKENING`
- `TARGET_PROGRESS`
- `INVALIDATED`
- `AMBIGUOUS`

Health uses closed-candle progress, MFE, MAE, elapsed bars and expected first-progress timing.

## Plan statuses

```text
NO_SIGNAL
REJECTED
WAIT_ENTRY
ENTRY_VALID
ACTIVE
TARGET1_HIT
TARGET2_HIT
COMPLETED
EXPIRED
INVALIDATED
AMBIGUOUS_INTRABAR
```

## Rejections versus limitations

Hard rejection/invalidation reasons are separate from analytical limitations. A qualified plan may have no rejection reason while still carrying:

- `HISTORICAL_OHLC_ONLY`
- `LIVE_SPREAD_UNVERIFIED`
- `BROKER_CONTRACT_UNAVAILABLE`

This prevents execution limitations from being misrepresented as failed analytical qualification.

## Position sizing

Lot size is deliberately not calculated without all of the following:

- account equity
- allowed monetary/percentage risk
- broker XAUUSD contract size
- tick size and tick value
- account currency conversion

The API returns `BROKER_CONTRACT_REQUIRED` rather than guessing.

## Data structures and complexity

For N M1 candles and four opportunity families:

- Phase 6 and Phase 7 index reuse
- one O(N) price-behaviour traversal
- four fixed runtime tracks
- Int32 plan-id arrays rather than 100K rich objects
- Uint8 status, health and target-stage arrays
- Float32 MFE, MAE and R-progress arrays
- plan objects created only for actual Phase 6 decision events
- bounded 300-candle obstacle scans only when a new plan is created
- O(log N) historical timestamp lookup through the Phase 6 index
- selected-window snapshot only in browser responses

## No-lookahead guarantee

At timestamp T:

- future entry fills are hidden
- future MFE/MAE are hidden
- future TP/SL reasons are hidden
- future target-stage stop movement is hidden
- future supersession reasons are hidden
- actual filled-entry metrics appear only after entry
- full-dataset and prefix-only snapshots are identical

## APIs

```text
GET /api/market/trades?analysisId=<uuid>&timestampMs=<optional>
GET /api/market/trades/history?analysisId=<uuid>&offset=0&limit=100
GET /api/market/trades/export?analysisId=<uuid>&format=csv|json
```

The window API also returns the Phase 7 plan at the final closed candle of the selected chart window.
