# Serverless Runtime and Timeframe Fix

## Reported failures

1. A successful analysis was followed by: `Analysis loaded, but complete report generation failed: Analysis expired or was not found.`
2. M1/M5/M15/H1/D1 timeframe switching did not load new data on Vercel.

## Root cause

The original implementation stored the full `CachedAnalysis` only in a module-level process-memory LRU. Vercel may run the analyze request and the next report/window request in different function instances. The second instance therefore had the UUID but not the associated candles and derived indices.

## Implemented correction

### Complete report

- `analyzeHistoricalMarket` now creates the full report before returning.
- `AnalyzeMarketResponse` includes `completeReport` and `recoveryRequest`.
- The React client stores the report immediately and adds it to the six-report collection.
- JSON and Markdown downloads are created client-side from the embedded report.
- The UI no longer issues a mandatory second `/api/market/report` call after analysis.

### Timeframe windows

- Every window request includes the original UTC period and Phase 7 execution assumptions.
- `/api/market/window` first checks the LRU.
- If the UUID is absent, it rebuilds the analysis from Finage and returns the requested window.
- The response includes `recoveredFromSource` and the `X-Analysis-Recovered` header.
- The browser caches exact timeframe/offset/limit windows.
- A request sequence guard prevents an older slow response from replacing a newer selected timeframe.
- The active tab shows the requested loading timeframe.

### Other APIs

The same recovery descriptor is accepted by report, candle export, trade export, market-state, opportunity, signal history and trade-plan routes. Cache-only 410 behavior was removed from these routes.

## Operational trade-off

Correctness no longer depends on Vercel instance reuse. However, the first uncached window/export request on a new instance can fetch Finage again. Use a shared Redis/KV cache later to reduce provider calls and latency if needed.

## Verification

- dependency-shim production source compile: passed
- serverless static route audit: passed
- injected cache-miss recovery test: passed
- complete 40K Phase 9 synthetic report: 797 signal events, 133 trade plans, 0.69 MB
- M1 and M5 marker alignment: passed
- responsive regression: passed across eight recorded viewports

Commands:

```bash
npm run verify:serverless
npm run verify:analysis-recovery
npm run verify:report-signals
npm run verify:responsive
```
