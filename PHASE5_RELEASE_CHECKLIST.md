# Phase 5 Release Checklist

## Hypotheses

- [x] Bullish hypothesis
- [x] Bearish hypothesis
- [x] Range hypothesis
- [x] Independent support and contradiction scores
- [x] Evidence-code audit trail
- [x] Leading hypothesis requires score and ranking gap
- [x] Conflicted hypothesis cannot become leading
- [x] Scores explicitly separated from probability

## Opportunity families

- [x] Pressure Release
- [x] Failed Break Reversal
- [x] Impulse Reload
- [x] Timeframe Rotation
- [x] Direction derived deterministically
- [x] Context, development, trigger and freshness sub-scores
- [x] Evidence and blocker lists
- [x] `ABSENT`, `WATCH`, `DEVELOPING`, `MATURE_CANDIDATE`, `DEGRADED`
- [x] Mature candidates remain non-executable
- [x] Severe data/noise/conflict blockers prevent mature qualification
- [x] Best candidate ranking prioritizes stage before raw score

## Integration

- [x] Phase 1–4 pipeline integration
- [x] Combined Phase 4 + Phase 5 O(N) summary pass
- [x] Latest Phase 5 snapshot in analysis response
- [x] Window-end Phase 5 snapshot
- [x] Arbitrary historical timestamp API
- [x] Phase 5 dashboard
- [x] JSON summary export
- [x] Cache lifecycle compatibility
- [x] 5K browser-window payload guard

## Correctness

- [x] Bullish-leading deterministic assertion
- [x] Range-leading deterministic assertion
- [x] Pressure Release assertion
- [x] Failed-break direction assertion
- [x] Impulse Reload assertion
- [x] Timeframe Rotation assertion
- [x] Partial/noisy degradation assertion
- [x] Full-data versus historical-prefix no-lookahead equality
- [x] Phase 3 regression
- [x] Phase 4 regression
- [x] 100K Phase 5 stress verification
- [x] Strict dependency-free core TypeScript compilation
- [x] Full source/test integration compilation using temporary external-package declarations

## External runtime gates

- [ ] Real Finage credential verification
- [ ] Full npm dependency installation
- [ ] Real Vitest run
- [ ] Real Next.js production build
- [ ] Chrome 100K interaction smoke test
