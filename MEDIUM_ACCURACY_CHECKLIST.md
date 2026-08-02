# Medium Accuracy V1 Checklist

## Data correctness
- [x] Closed-market provider candles removed
- [x] Repeated near-flat stale candles removed conservatively
- [x] Real data-gap safety candles marked incomplete
- [x] Higher timeframes rebuilt from cleaned M1

## Context
- [x] Automatic configurable warm-up fetch
- [x] Warm-up excluded from visible chart/report period
- [x] Selected interval metrics separated from context metrics

## Balanced qualification
- [x] Trade Quality Score independent from Phase 6 candidate score
- [x] A/B/C/BLOCKED grades
- [x] Regime compatibility component
- [x] H1 location component
- [x] Multi-timeframe alignment component
- [x] Freshness/late-entry component
- [x] Session-quality component
- [x] Target-space component

## Target engine
- [x] M1 swing is soft
- [x] M5 swing is medium
- [x] M15/H1 and range boundaries are hard
- [x] Soft obstacle cannot veto trade
- [x] Minimum 1.5R preserved

## Signal reduction
- [x] Timeframe Rotation is confluence-only
- [x] Nearby same-direction families merged
- [x] Unclear opposite-direction conflict suppressed
- [x] Default chart displays A/B only
- [x] Research markers optional

## Verification
- [x] Medium-accuracy deterministic verification
- [x] Phase 3 regression
- [x] Phase 4 regression
- [x] Phase 5 regression
- [x] Phase 6 regression
- [x] Phase 7 regression
- [x] Report/marker regression
- [x] Responsive regression
- [x] Serverless recovery regression
- [ ] Real Finage A/B outcome calibration
- [ ] Full dependency-backed Next.js build on target/Vercel
