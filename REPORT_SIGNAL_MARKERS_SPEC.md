# Automatic Analysis Reports and Historical Signal Markers

## Purpose

Every successful Finage fetch now produces two outputs immediately:

1. A complete structured historical-analysis report for later comparison.
2. Historical Phase 6 signal markers aligned to the currently loaded chart window.

The report and chart markers do not change the underlying Phase 1–7 decision logic.

## Automatic report workflow

```text
Fetch candles
→ complete Phase 1–7 analysis
→ return report summary with analyze response
→ automatically load complete report
→ retain last six reports in the current browser tab
→ export one comparison bundle
```

The report collection is intentionally session-memory only. Refreshing or closing the page clears the collected reports unless the bundle has been downloaded.

## Complete report contents

The JSON report includes:

- requested UTC period and execution assumptions
- data-quality counts and gap samples
- all timeframe candle-behaviour summaries
- all timeframe price-behaviour summaries
- complete multi-timeframe state summary
- hypothesis and opportunity summary
- signal lifecycle summary
- trade-management summary
- every CONFIRMED signal
- every CONTINUATION signal
- every INVALIDATED signal event
- every Phase 7 analytical trade plan
- family-wise signal and trade-plan breakdown
- rejection and limitation reasons
- entry-fill timing
- MFE and MAE
- target progression
- deterministic engine configuration
- flat comparison metrics for multi-report analysis
- diagnostic flags and key observations

Observed rates are descriptive historical counts. They are not presented as profitability or calibrated probability.

## Report APIs

```text
GET /api/market/report?analysisId=<uuid>&format=json
GET /api/market/report?analysisId=<uuid>&format=md
```

JSON is the complete machine-readable report. Markdown is a concise human-readable report.

## Six-report comparison bundle

The browser retains the latest six complete JSON reports in memory. The bundle format is:

```json
{
  "bundleVersion": "1.0",
  "exportedAtUtc": "...",
  "reportCount": 6,
  "reports": []
}
```

This bundle is the preferred file for later threshold, rejection, session and opportunity-family review.

## Historical chart markers

The window API returns all Phase 6 events that belong to the loaded chart window:

- CONFIRMED BUY/SELL
- CONTINUATION BUY/SELL
- INVALIDATED events

Markers are aligned to an actual displayed candle timestamp. A one-minute signal is mapped to its containing M5, M15, H1 or D1 candle when a higher timeframe chart is selected.

## Marker controls

The chart provides independent controls for:

- confirmed BUY/SELL signals
- continuation signals
- invalidations
- latest Phase 7 entry, SL and target price lines
- show all signal events
- hide all signal events

Confirmed and continuation signals are visible by default. Invalidations remain optional to reduce chart clutter.

## Marker DSA

Signal events are stored chronologically. Window extraction uses:

- binary search to find the first relevant event slot
- forward scan only through events inside the requested time range
- binary search to align each signal to the displayed timeframe candle
- compact marker objects only for the loaded 500–5,000-candle window

The server never sends markers for the complete 100K dataset unless they belong to the selected chart window.

## Semantics

```text
BUY / SELL marker = Phase 6 historical decision event
Entry / SL / TP lines = current Phase 7 analytical plan
Neither is live broker execution permission
```
