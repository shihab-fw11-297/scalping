# Medium Accuracy V1 Upgrade

This release changes the chart from a Phase 6 pattern feed into a balanced trade-ready view.

## Implemented

- Removes provider candles returned during the configured Friday-to-Sunday FX closure.
- Conservatively removes repeated near-flat stale quote runs.
- Automatically fetches up to 30 calendar days of prior warm-up context.
- Generates chart/report signals only inside the user-selected interval.
- Marks candles after real tradable-data gaps as incomplete for setup safety.
- Rebuilds M5, M15, H1 and D1 from cleaned M1 candles.
- Classifies M1 swings as soft obstacles, M5 swings as medium and M15/H1/range boundaries as hard.
- Soft M1 obstacles no longer reject an otherwise valid trade.
- Adds an independent Trade Quality Score with pattern, regime, location, alignment, timing, target and session components.
- Uses balanced grades: A from 80, B from 68, C below 68, and BLOCKED for hard failures.
- Makes Timeframe Rotation a context/confluence signal rather than an executable standalone trade.
- Merges nearby multi-family trade candidates into one market episode.
- Suppresses opposite-direction episodes when neither side has a clear quality advantage.
- Default chart shows only deduplicated A/B trade-ready BUY/SELL markers.
- Phase 6 pattern confirmations, continuations and invalidations remain available under Research Signals.
- Reports include warm-up, removed closure/stale candles, grade counts, deduplicated trade-ready signals and duplicate episodes.

## Signal semantics

- `PATTERN_CONFIRMED`: Phase 6 analytical pattern; not an execution signal.
- `A`: stronger medium-accuracy trade-ready signal.
- `B`: valid medium-quality trade-ready signal.
- `C`: research-only candidate.
- `BLOCKED`: failed a hard data, structure, timing or target requirement.

The grade is not a win probability. It must be calibrated using resolved real XAUUSD trades.

## Verification

Run:

```bash
npm install --production=false
npm run verify:medium-accuracy
npm run verify:phase7
npm run verify:report-signals
npm run verify:responsive
npm run verify:serverless
npm run build
```
