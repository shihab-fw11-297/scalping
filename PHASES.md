# Fresh Build Phases

## Phase 1 — Market Data Foundation — Implemented

Historical Finage M1 fetching, validation, chunking, exact ranges, gap audit, cleaned timeframe aggregation, completeness metadata, chart windows and export.

## Phase 2 — Candle Behaviour Engine — Implemented

Candle anatomy, 1/3/5/10/20 comparisons, expansion, compression, displacement, rejection, wick sweeps, indecision, exhaustion candidates, behaviour summaries and chart-window inspection.

## Phase 3 — Price Behaviour Engine — Implemented

Directional progress, overlap/noise, impulse, pullback depth, pullback duration, recovery speed, break acceptance/failure, acceleration, decay, freshness and late-entry risk.

## Phase 4 — Multi-Timeframe Market State — Implemented

Synchronized 1D environment, rolling 5H campaign, 1H location, 15M narrative, 5M setup construction, 1M execution context, cross-timeframe alignment and composite state. Higher-timeframe inputs are closed-candle only.

## Phase 5 — Hypothesis & Opportunity Engine — Implemented

Bullish, bearish and range hypotheses with support/contradiction trails. Pressure Release, Failed Break Reversal, Impulse Reload, Timeframe Rotation and Session Liquidity QML opportunities.

## Phase 6 — Signal Decision Lifecycle — Implemented

Independent family tracks with OBSERVING, WATCH, ARMED, CONFIRMED, CONTINUATION, INVALIDATED and NO TRADE. Includes persistence, fast-track confirmation, duplicate suppression, expiry, cooldown and no-lookahead lookup.

## Phase 7 — Entry, Target, Risk & Trade Management — Implemented

Family-specific entry zones, no-chase/expiry, structural stops, execution-cost assumptions, target-space hierarchy, cost-adjusted R:R, TP1/TP2/TP3, MFE/MAE, trade health, ambiguity handling and A/B/C/BLOCKED trade grading.

## Phase 7.2 — Automatic Reports and Historical Visualization — Implemented

Every fetch creates a complete report. The browser retains up to six reports. Trading view shows deduplicated Grade A/B markers; Phase 6 research events remain optional.

## Phase 8 — Session, Liquidity and Market Structure — Implemented

DST-aware sessions, exact previous-day/week levels, Asia/London/New York ranges, M15/H1 liquidity swings, equal levels, sweep/reclaim events and closed-candle BOS/MSS.

## Phase 9 — Session Liquidity QML — Implemented

Meaningful liquidity sweep → reclaim → MSS/strong BOS → validated QML geometry → first/controlled-second retest → opposite-liquidity target → Phase 6 confirmation → Phase 7 A/B permission.

## Phase 10 — Replay & Learning Dataset

No-lookahead replay, resolved outcome labels, rejected/missed opportunities, MFE/MAE distributions and structured expert feedback.

## Phase 11 — Paper & Demo Validation

Real-time paper decisions, one-position governance, daily risk limits and controlled demo execution.

## Phase 12 — Statistical Intelligence

Expected excursion distributions, family/session/regime calibration, failure estimates, ranking, walk-forward evaluation and probability calibration.

## Phase 13 — AI Explanation

AI explains stored measurements and deterministic decisions. It does not invent signals or override hard risk gates.

## Phase 14 — Controlled Live Execution

Micro-risk deployment only after data, replay, paper, statistical and operational release gates pass.
