# Fresh Build Phases

## Phase 1 — Market Data Foundation — Implemented

Historical Finage M1 fetching, validation, chunking, exact ranges, gap audit, timeframe aggregation, completeness metadata, chart windows and export.

## Phase 2 — Candle Behaviour Engine — Implemented

Candle anatomy, 1/3/5/10/20 comparisons, expansion, compression, displacement, rejection, wick sweeps, indecision, exhaustion candidates, behaviour summaries and chart-window inspection.

## Phase 3 — Price Behaviour Engine — Implemented

Directional progress, overlap/noise, impulse, pullback depth, pullback duration, recovery speed, break acceptance/failure, acceleration, decay, freshness and late-entry risk.

## Phase 4 — Multi-Timeframe Market State — Implemented

Synchronized 1D environment, rolling 5H campaign, 1H location, 15M narrative, 5M setup construction, 1M execution context, cross-timeframe alignment and composite market state. All higher-timeframe inputs are closed-candle only.

## Phase 5 — Hypothesis & Opportunity Engine — Implemented

Bullish, bearish and range hypotheses with support/contradiction audit trails. Pressure Release, Failed Break Reversal, Impulse Reload and Timeframe Rotation candidates.

## Phase 6 — Signal Decision Lifecycle — Implemented

Independent family tracks with OBSERVING, WATCH, ARMED, CONFIRMED, CONTINUATION, INVALIDATED and NO TRADE. Includes persistence, fast-track confirmation, duplicate suppression, expiry, cooldown and no-lookahead historical lookup.

## Phase 7 — Entry, Target, Risk & Trade Management — Implemented

Family-specific entry zones, no-chase and expiry, protected-structure stops, user-configured spread/slippage assumptions, complete closed M1/M5/M15/H1 target levels, cost-adjusted planned and filled R:R, TP1/TP2/TP3, conservative MFE/MAE, trade health, intrabar ambiguity rejection, break-even/trailing instructions and historical APIs. It remains analytical, not live execution.

## Phase 8 — Replay & Learning Dataset

No-lookahead replay, outcome labels, rejected opportunities, missed opportunities, MFE/MAE distributions and structured expert feedback.

## Phase 9 — Paper & Demo Validation

Real-time paper decisions and controlled demo execution.

## Phase 10 — Statistical Intelligence

Expected 5/10-minute excursion distributions, failure estimates, ranking and probability calibration.

## Phase 11 — AI Explanation

AI explains stored measurements and deterministic decisions. It does not invent signals.

## Phase 12 — Controlled Live Execution

Micro-risk deployment only after all release gates pass.

## Phase 7.2 — Automatic Reports and Historical Signal Visualization — Implemented

Every fetch generates a complete comparison-ready report. The browser retains up to six reports for bundle export. All historical confirmed, continuation and invalidation signal events can be shown or hidden on the selected chart window.
