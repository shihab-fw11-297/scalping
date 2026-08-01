# Report and Signal Marker Release Checklist

## Automatic reports

- [x] Report summary generated inside every successful analysis
- [x] Complete report automatically requested after fetch
- [x] Data-quality section
- [x] Latest market-context section
- [x] Signal lifecycle section
- [x] Trade-plan section
- [x] Observed-rate section
- [x] Flat comparison metrics
- [x] Family-wise breakdown
- [x] All signal events included
- [x] All analytical trade plans included
- [x] MFE/MAE included
- [x] Rejection reasons included
- [x] Analytical limitations included
- [x] Engine configurations included
- [x] JSON report endpoint
- [x] Markdown report endpoint
- [x] Automatic report-ready panel
- [x] Current report download controls

## Multi-fetch collection

- [x] Last six complete reports retained in browser-tab memory
- [x] Duplicate analysis IDs prevented
- [x] Oldest report removed after six
- [x] One-click JSON comparison bundle
- [x] Report list shows period, signals, plans, entries and TP1 count
- [x] Clear-report control
- [x] No server database introduced
- [x] Collection survives cache eviction while tab remains open
- [x] Page refresh behaviour documented

## Chart signals

- [x] Window API includes historical signal markers
- [x] Confirmed BUY marker
- [x] Confirmed SELL marker
- [x] Continuation BUY marker
- [x] Continuation SELL marker
- [x] Invalidation marker
- [x] M1 marker alignment
- [x] M5 marker alignment
- [x] M15/H1/D1 containing-candle alignment
- [x] Confirmed toggle
- [x] Continuation toggle
- [x] Invalidation toggle
- [x] Show-all button
- [x] Hide-all button
- [x] Latest entry/SL/TP toggle
- [x] Marker count shown for loaded window
- [x] Marker labels include action, lifecycle, family and score

## Optimization

- [x] Chronological event slots reused
- [x] Binary search to first relevant event
- [x] Forward scan ends at window boundary
- [x] Binary-search candle alignment
- [x] Only loaded-window markers sent to browser
- [x] Six-report in-memory cap
- [x] Report contains summaries and events, not complete candle arrays
- [x] Existing 5K browser-window cap preserved
- [x] Existing <8 MB browser payload guard preserved

## Verification

- [x] Strict source TypeScript verification with temporary dependency declarations
- [x] 40K complete-report generation
- [x] Complete signal-event count equality
- [x] Complete trade-plan count equality
- [x] M1 chart marker verification
- [x] M5 marker alignment verification
- [x] Report-size guard
- [x] 100K Phase 1–7 benchmark regression
- [x] Browser payload benchmark includes signal markers

## External runtime gates

- [ ] Install production dependencies
- [ ] Run actual Vitest suite
- [ ] Run Next.js production build
- [ ] Run real Finage fetch
- [ ] Visually inspect marker stacking in Chrome
- [ ] Generate and review 5–6 real XAUUSD reports
