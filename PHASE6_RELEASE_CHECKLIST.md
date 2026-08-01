# Phase 6 Release Checklist

## Lifecycle engine

- [x] Independent track per opportunity family
- [x] OBSERVING state
- [x] WATCH state
- [x] ARMED state
- [x] CONFIRMED state
- [x] CONTINUATION state
- [x] INVALIDATED state
- [x] NO_TRADE state
- [x] BUY/SELL/NONE decision labels
- [x] Candidate episode identity
- [x] Episode age and transition timestamps
- [x] Reference price captured at every decision candle

## Confirmation quality

- [x] Mature-candidate requirement
- [x] Minimum candidate score
- [x] Minimum hypothesis support
- [x] Ranking-gap control
- [x] Family-specific trigger validation
- [x] Closed-candle persistence gate
- [x] Strict fast-track confirmation
- [x] Clean execution requirement
- [x] Freshness requirement
- [x] Reversal/rotation exception
- [x] No direct confirmation from neutral direction

## Safety and rejection

- [x] Partial-data blocking
- [x] Noisy-market blocking
- [x] Destructive-timeframe-conflict blocking
- [x] Direction-conflict blocking
- [x] Late-entry blocking
- [x] Extended-move blocking
- [x] Missing-trigger blocking
- [x] Ambiguous-hypothesis blocking
- [x] Cooldown blocking
- [x] Structured no-trade reasons

## Lifecycle control

- [x] Duplicate confirmation suppression
- [x] One-bar candidate grace
- [x] WATCH expiry
- [x] ARMED expiry
- [x] Direction-flip invalidation
- [x] Opposite-hypothesis invalidation
- [x] Degraded-candidate invalidation
- [x] Candidate-disappearance invalidation
- [x] Continuation separation requirement
- [x] Continuation lookback limit

## Integration

- [x] Phase 4/5/6 combined O(N) traversal
- [x] Typed-array lifecycle index
- [x] WeakMap dataset-bound index reuse
- [x] O(log N) historical signal lookup
- [x] Latest signal in analysis response
- [x] Window-end signal snapshot
- [x] Arbitrary timestamp signal API
- [x] Paginated signal-event history API
- [x] Recent event ring in dashboard summary
- [x] Signal decision dashboard
- [x] JSON export metadata
- [x] Phase 6 summary statistics
- [x] Strongest-signal bounded heap

## Verification

- [x] ARMED → CONFIRMED fixture
- [x] Duplicate-suppression fixture
- [x] Invalidation fixture
- [x] Continuation fixture
- [x] No-trade/partial-data fixture
- [x] Expiry fixture
- [x] Prefix no-lookahead fixture
- [x] 100K signal-decision stress test
- [x] Phase 3 regression
- [x] Phase 4 regression
- [x] Phase 5 regression
- [x] Full source integration TypeScript check with dependency shims
- [x] Browser payload benchmark

## External release gates

- [ ] Real Finage API verification
- [ ] Real npm dependency installation
- [ ] Real Vitest run with installed dependencies
- [ ] Next.js production build
- [ ] Chrome 100K interaction smoke test
