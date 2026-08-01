# Phase 5 — Hypothesis & Opportunity Engine Specification

## Purpose

Phase 5 converts the synchronized Phase 4 market state into competing explanations and opportunity candidates. It still does not generate a trade signal, entry, stop-loss, target or execution instruction.

## Three hypotheses

Every closed M1 anchor receives exactly three evidence-ranked hypotheses:

- `BULLISH`
- `BEARISH`
- `RANGE`

Each hypothesis contains:

- support score
- contradiction score
- net evidence score
- state: `DORMANT`, `WEAK`, `ACTIVE`, `LEADING` or `CONFLICTED`
- exact supporting and contradicting evidence codes

A hypothesis becomes `LEADING` only when it exceeds the configured minimum score, leads the second-ranked hypothesis by the configured gap, and is not conflicted. Scores are evidence rankings, not probabilities.

## Four opportunity families

### Pressure Release

Measures compression, directional pressure, break attempts, acceptance, execution quality and freshness.

### Failed Break Reversal

Measures failed bullish/bearish breaks, range-edge context and opposite recovery. A failed bullish break maps to a bearish reversal candidate; a failed bearish break maps to bullish.

### Impulse Reload

Measures higher-timeframe campaign support, controlled pullback, pullback depth, recovery speed and lower-timeframe continuation.

### Timeframe Rotation

Measures productive timeframe disagreement, correction/rotation context and lower-timeframe rotation back toward the higher-timeframe campaign.

## Opportunity stages

- `ABSENT`
- `WATCH`
- `DEVELOPING`
- `MATURE_CANDIDATE`
- `DEGRADED`

`MATURE_CANDIDATE` means that the deterministic Phase 5 evidence is complete enough for Phase 6 to evaluate. It is not a signal.

## Blockers

Candidates are penalized or degraded by:

- noisy market
- destructive timeframe conflict
- partial data
- direction conflict
- high late-entry risk
- extended move
- missing trigger

## No-lookahead rule

Phase 5 receives only:

- the Phase 4 snapshot synchronized to a closed M1 candle
- the Phase 3 price-behaviour feature available at that same closed M1 candle

No future candle, future higher-timeframe close or future outcome is used.

## DSA and memory design

- one O(N) synchronized pass for Phase 4 and Phase 5 summaries
- existing forward pointers for closed higher-timeframe synchronization
- existing typed-array Phase 3 preparation
- fixed-size min heaps for strongest Phase 4 and Phase 5 events
- WeakMap index reuse tied to the in-memory dataset
- binary-search arbitrary timestamp lookup
- one Phase 5 snapshot per browser window rather than 100K browser snapshots

## Explicit exclusions

Phase 5 does not implement:

- `OBSERVING`, `ARMED`, `CONFIRMED` or other signal lifecycle states
- entry price
- stop-loss
- target
- risk-reward
- spread/slippage execution permission
- automated trading
- win probability
