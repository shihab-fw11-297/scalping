# Medium Accuracy V1 — XAUUSD Signal Upgrade

## Objective

This profile is designed to reduce chart noise without turning the engine into a near-zero-signal system. It separates research-level pattern detection from executable trade-ready signals.

It does **not** claim a proven win rate. Accuracy must be measured again from new resolved real-XAUUSD reports because the decision and target logic changed.

## Decision flow

```text
Clean provider data
→ build warm-up context
→ run Phase 1–6 pattern research
→ construct Phase 7 plan
→ classify target obstacles
→ calculate trade-quality score
→ apply medium A/B threshold
→ merge overlapping market episodes
→ show one clean trade-ready marker
```

## Data correctness

- Candles during the configured FX weekend closure are removed before aggregation.
- Repeated identical near-flat provider quotes are conservatively removed.
- Three M1 candles after a real tradable-data gap are marked incomplete.
- M5, M15, H1 and D1 completeness inherits unsafe M1 source candles.
- The displayed interval is separated from context data.

## Automatic warm-up

- Default context request: 30 calendar days before the selected interval.
- Warm-up is automatically reduced when required by `APP_MAX_CANDLES`.
- All market-state, hypothesis, signal and trade engines use context candles.
- Reports, chart totals and histories include only the selected interval.
- Warm-up candles never appear at chart offset zero.

Environment setting:

```env
ANALYSIS_WARMUP_CALENDAR_DAYS=30
```

## Obstacle hierarchy

| Class | Sources | Behaviour |
|---|---|---|
| Soft | M1 swing | Warning/management reference only |
| Medium | M5 swing | Confluence/management reference only |
| Hard | M15/H1 swing and M15/H1 range boundary | Can limit target space and reject R:R |

A small internal M1 swing can no longer reject an otherwise valid plan by itself.

## Trade-quality score

The score is capped at 100 and uses:

- pattern quality: 20
- regime compatibility: 20
- location quality: 20
- multi-timeframe alignment: 15
- timing/freshness: 15
- target quality: 15
- trading session: 5

The raw component total is capped to 100 before grade assignment.

Grades:

```text
A: 80–100
B: 68–79.99
C: below 68
BLOCKED: a mandatory execution rule failed
```

Only A and B are trade-ready.

## Mandatory blocks

Examples:

- partial or gap-unsafe source data
- invalid entry zone or structural stop
- stop too small or too wide
- target space below configured net R:R
- entry already beyond the no-chase level
- quality below medium threshold
- Timeframe Rotation used as a standalone trade

## Strategy roles

- `PRESSURE_RELEASE`: primary continuation/release setup.
- `FAILED_BREAK_REVERSAL`: executable only when the full plan passes location, timing and target grading.
- `IMPULSE_RELOAD`: remains available but requires its Phase 6 detector to confirm.
- `TIMEFRAME_ROTATION`: context/confluence only; never a standalone A/B trade.

## Episode arbitration

Trade-ready plans inside a 12-minute episode are merged:

- same direction: keep the highest-quality plan
- opposite directions with less than 8 score points difference: suppress the conflicted episode
- clear opposite-direction advantage: keep the stronger plan

This prevents multiple strategy names from showing several signals for the same market move.

## Chart modes

Trading view, default:

- Grade A
- Grade B
- entry/SL/TP levels
- trade outcomes

Research mode, optional:

- Phase 6 confirmed patterns
- continuations
- invalidations

`PATTERN_CONFIRMED` is not treated as an executable BUY/SELL. The BUY/SELL arrows are generated only from deduplicated A/B Phase 7 plans.

## Report additions

- context and warm-up candle counts
- closed-market/stale candle removals
- gap-safety count
- A/B/C/BLOCKED counts
- average quality score
- deduplicated trade-ready count
- overlapping episodes suppressed
- hard/medium/soft obstacle details per plan
- quality components, session and reasons per plan

## Verification

```bash
npm run verify:medium-accuracy
npm run verify:phase3
npm run verify:phase4
npm run verify:phase5
npm run verify:phase6
npm run verify:phase7
npm run verify:report-signals
npm run verify:responsive
npm run verify:serverless
npm run build
```

Latest deterministic medium-profile fixture:

```text
Context candles:              20,000
Analytical plans:                 95
Grade A:                           0
Grade B:                          13
Trade-ready A/B:                  13
Blocked/research-only plans:      82
```

This fixture verifies behaviour and signal volume only. It is not a historical win-rate result.
