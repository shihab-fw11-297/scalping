# Phase 7 Release Checklist

## Entry construction

- [x] Phase 6 CONFIRMED input
- [x] Phase 6 CONTINUATION input
- [x] Independent family plans
- [x] Pressure Release entry rule
- [x] Failed Break Reversal entry rule
- [x] Impulse Reload entry rule
- [x] Timeframe Rotation entry rule
- [x] Entry-zone lower/upper bounds
- [x] Preferred entry
- [x] Entry cannot fill inside the closed signal candle
- [x] No-chase price
- [x] Family-specific expiry bars
- [x] Exact expiry timestamp

## Structural risk

- [x] Family-specific protected-extreme lookback
- [x] Structural invalidation price
- [x] Average-range safety buffer
- [x] Initial stop-loss
- [x] Stop distance
- [x] Stop distance in average ranges
- [x] Minimum-stop gate
- [x] Maximum-stop gate
- [x] Partial-source-data rejection
- [x] Complete structural lookback required

## Execution assumptions

- [x] User-configured spread assumption
- [x] User-configured slippage assumption
- [x] Cost assumptions stored in analysis metadata
- [x] Cost included in total risk
- [x] Costs explicitly marked not live verified
- [x] Position size blocked without broker contract/account inputs
- [x] Hard rejections separated from analytical limitations

## Targets and risk-reward

- [x] Prior-only local swing scan
- [x] Nearest obstacle measurement
- [x] Complete closed M1/M5/M15/H1 swing candidates
- [x] Signal-containing higher-timeframe candle excluded from prior targets
- [x] M15/H1 range-boundary candidates
- [x] Expected-10-minute capacity as target-space cap
- [x] Bounded no-obstacle expansion estimate
- [x] Available target distance
- [x] Cost-adjusted available R:R
- [x] Configurable minimum net R:R
- [x] TP1
- [x] TP2 when space exists
- [x] TP3 only with sufficient extension space
- [x] Target-space rejection
- [x] R:R rejection
- [x] No forced 3R target-space fallback

## Expected movement

- [x] Expected five-minute distance
- [x] Expected ten-minute distance
- [x] Expected first-progress bars
- [x] Confidence based on prior efficiency/noise
- [x] No future excursion used in expectation

## Lifecycle and management

- [x] REJECTED
- [x] WAIT_ENTRY
- [x] ENTRY_VALID
- [x] ACTIVE
- [x] TARGET1_HIT
- [x] TARGET2_HIT
- [x] COMPLETED
- [x] EXPIRED
- [x] INVALIDATED
- [x] AMBIGUOUS_INTRABAR
- [x] Entry-fill tracking
- [x] Actual filled-entry risk and TP1 R:R
- [x] Entry-candle MFE/MAE excluded
- [x] MFE tracking
- [x] MAE tracking
- [x] Progress in risk units
- [x] HEALTHY
- [x] STALLED
- [x] WEAKENING
- [x] TARGET_PROGRESS
- [x] Break-even stop after TP1
- [x] TP1 trail after TP2
- [x] Superseded-plan invalidation

## Historical correctness

- [x] Same-candle entry/stop ambiguity rejected
- [x] Same-candle entry/no-chase ambiguity rejected
- [x] Pre-entry stop touch invalidates
- [x] Same-candle stop/target ambiguity rejected
- [x] Future entry not visible at earlier timestamps
- [x] Future MFE/MAE not visible
- [x] Future TP/SL reasons not visible
- [x] Future protective-stop movement not visible
- [x] Future supersession reason not visible
- [x] Full-sequence vs prefix equality
- [x] Closed-candle processing

## APIs, UI and export

- [x] `/api/market/trades`
- [x] `/api/market/trades/history`
- [x] `/api/market/trades/export` streamed CSV/JSON
- [x] Window-end Phase 7 snapshot
- [x] Phase 7 summary in analyze response
- [x] Phase 7 metadata in streamed JSON export
- [x] Entry/SL/TP dashboard
- [x] Current protective stop
- [x] Management action
- [x] Entry/SL/TP chart price lines
- [x] User assumption controls

## Optimization and verification

- [x] Fixed four-track runtime
- [x] Compact typed arrays
- [x] Rich objects only for actual plans
- [x] Bounded obstacle scan
- [x] 100K benchmark
- [x] Browser payload guard
- [x] Phase 3 regression
- [x] Phase 4 regression
- [x] Phase 5 regression
- [x] Phase 6 regression
- [x] Strict market-core TypeScript compile
- [x] Full source integration compile with temporary dependency declarations

## External runtime gates

- [ ] Real Finage API-key verification
- [ ] Finage subscription depth verification
- [ ] Full npm dependency installation
- [ ] Full Vitest execution with installed packages
- [ ] Next.js production build with installed packages
- [ ] Real Chrome 100K interaction test
- [ ] Broker-specific spread/slippage comparison
