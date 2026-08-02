# Phase 8–9 Session Liquidity QML Release Checklist

## Phase 8 foundation

- [x] DST-aware Asia/London/New York sessions
- [x] London/New York overlap classification
- [x] Previous day high/low
- [x] Exact previous completed trading-week high/low
- [x] Asia/London/New York opening ranges
- [x] Confirmed M15/H1 swings
- [x] Equal-high/equal-low clusters
- [x] Nearest liquidity above/below
- [x] Sweep requires excursion and reclaim
- [x] Per-level sweep cooldown
- [x] Closed-candle BOS/MSS
- [x] No future pivot usage
- [x] Transition-based summary counts

## Phase 9 QML

- [x] QML state machine
- [x] Sweep event preserved until MSS
- [x] Shoulder/head geometry validation
- [x] Invalid/stale shoulder fallback
- [x] First retest preferred
- [x] Controlled second retest allowed
- [x] Third retest expires
- [x] Head-based invalidation
- [x] Opposite-side liquidity targets
- [x] Bullish and bearish symmetry verification
- [x] Phase 5 opportunity integration
- [x] Phase 6 signal lifecycle integration
- [x] Phase 7 entry/SL/TP integration
- [x] Grade A/B default markers
- [x] Duplicate market-episode merge

## UI/report

- [x] Session Liquidity QML dashboard panel
- [x] PWH/PWL/PDH/PDL chart overlays
- [x] Asia/London/New York range overlays
- [x] QML level and target overlays
- [x] Session/QML overlay toggle
- [x] QML family label in chart markers
- [x] QML summary in complete JSON report
- [x] QML metrics in readable Markdown report

## Verification

- [x] Core strict TypeScript check
- [x] UI focused TypeScript check with temporary dependency declarations
- [x] 84 TypeScript/TSX source/script syntax checks
- [x] Phase 3 regression
- [x] Phase 4 regression
- [x] Phase 5 regression
- [x] Phase 6 regression
- [x] Phase 7 regression
- [x] Medium-accuracy regression
- [x] Phase 8 deterministic verifier
- [x] Phase 9 bullish verifier
- [x] Phase 9 mirrored bearish verifier
- [x] Prefix no-lookahead verifier
- [x] Report/marker regression
- [x] Responsive static verification
- [x] Serverless static verification
- [ ] Dependency-backed `next build` on a machine with npm access
- [ ] Real Finage A/B calibration
- [ ] Paper-trading validation
