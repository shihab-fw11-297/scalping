# Phase 4 Release Checklist

## Timeframe responsibilities

- [x] 1D environment implemented
- [x] rolling 300-minute campaign implemented
- [x] 1H location implemented
- [x] 15M narrative implemented
- [x] 5M construction context implemented
- [x] 1M execution context implemented
- [x] composite market state implemented
- [x] fresh/mature/productive/destructive alignment implemented

## Correctness

- [x] every snapshot anchored to a closed M1 candle
- [x] higher timeframes use closed candles only
- [x] configured New York or UTC D1 close respected
- [x] incomplete current higher timeframe remains visible as `PARTIAL`
- [x] partial layer excluded from composite alignment
- [x] no silent fallback that presents stale state as current
- [x] rolling 5H handles insufficient data and session reopen
- [x] no future-candle lookahead
- [x] evidence score labelled as coherence, not probability
- [x] no signal, entry, stop or target logic

## DSA/performance

- [x] O(N) rolling prefix calculations
- [x] O(N) monotonic high/low deques
- [x] O(N) two-pointer time-window starts
- [x] O(N) forward synchronization during full summary
- [x] O(log N) arbitrary timestamp lookup
- [x] fixed-size strongest-event heap
- [x] typed rolling arrays
- [x] WeakMap state-index cache
- [x] candle-budget LRU protects memory across multiple analyses
- [x] no 100K snapshot object array stored
- [x] 100K Phase 4 verification under one second on the current container
- [x] browser still receives one Phase 4 snapshot per chart window, not 100K snapshots

## API/UI/export

- [x] analysis response includes Phase 4 summary
- [x] analysis response includes latest synchronized snapshot
- [x] window response includes state at window end
- [x] arbitrary timestamp state API implemented
- [x] Phase 4 dashboard implemented
- [x] JSON export includes Phase 4 summary and latest state
- [x] responsive dashboard styling added

## Automated verification

- [x] unclosed M5 leak test
- [x] rolling 5H campaign test
- [x] six-layer availability test
- [x] exact sample-count test
- [x] no-lookahead prefix/full equality test
- [x] incomplete M5 partial-state test
- [x] 100K stress verification script
- [x] Phase 3 regression script still passes
- [x] core strict TypeScript compilation passes
- [x] full source compilation with temporary dependency stubs passes

## External environment gates

- [ ] install project dependencies from a working npm registry
- [ ] run full Vitest suite
- [ ] run actual Next.js production build
- [ ] execute real Finage XAUUSD verification with the user API key
- [ ] perform real Chrome browser smoke test

The unchecked items require external package/network/browser access. They are not missing implementation items.
