# Phase 1 Release Checklist

## A. Implemented and verified in code

- [x] XAUUSD-only Finage historical API integration
- [x] Real Finage verification command: `npm run verify:finage`
- [x] Runtime validation of the Finage response envelope and OHLC records
- [x] Exact `[from,to)` timestamp filtering
- [x] Provider date chunks below the configured 50K request boundary
- [x] Bounded concurrency, timeout and transient retry handling
- [x] 100K valid M1 processing limit
- [x] Full dataset retained only in expiring server memory
- [x] Browser receives a maximum configurable candle window; default 5,000
- [x] Compact browser behaviour DTO instead of full analysis objects
- [x] Browser-window payload benchmark guard
- [x] Chart data application deferred with `requestAnimationFrame`
- [x] Data table limited to the latest 300 rows in the loaded window
- [x] Backpressure-aware streamed CSV export
- [x] Backpressure-aware streamed JSON export
- [x] Weekend closures separated from missing tradable candles
- [x] Default weekend schedule uses Friday/Sunday 17:00 America/New_York
- [x] New York weekend schedule automatically follows DST
- [x] Optional fixed-UTC weekend schedule remains configurable
- [x] M5/M15/H1/D1 candles contain explicit coverage metadata
- [x] Request-boundary partial candles are not counted as provider failures
- [x] Expected closures are not counted as missing provider data
- [x] True missing children are classified as `MISSING_DATA`
- [x] Overfull/conflicting coverage is classified as `OVERFULL`
- [x] Daily boundary is configurable and documented
- [x] Default D1 boundary is 17:00 America/New_York with DST
- [x] Alternative UTC-midnight D1 boundary is supported
- [x] New York 23/25-hour DST trading days are supported
- [x] No future-candle lookahead
- [x] Equal-value quickselect worst-case fixed with three-way partition

## B. Verification completed in this environment

- [x] 40 TypeScript/TSX files passed syntax transpilation
- [x] Strict type-check passed for all dependency-free market-core modules
- [x] Exact end-time exclusion assertion passed
- [x] Winter weekend closure assertion passed
- [x] Summer/DST weekend closure assertion passed
- [x] New York D1 winter boundary assertion passed
- [x] New York D1 summer boundary assertion passed
- [x] 23-hour DST trading-day assertion passed
- [x] Missing child coverage assertion passed
- [x] Partial request-boundary coverage assertion passed
- [x] 100K equal-value quickselect completed without degeneration
- [x] 100K synthetic market-core benchmark completed
- [x] 5K browser window payload measured below the 5 MB guard

## C. Requires the user's runtime credentials/environment

These are not missing implementations. They are execution checks that cannot be truthfully marked passed without the actual environment.

- [ ] Put the real `FINAGE_API_KEY` in `.env.local`
- [ ] Run `npm run verify:finage` and confirm a valid XAUUSD M1 response
- [ ] Confirm the user's Finage plan provides the requested M1 historical depth
- [ ] Run `npm install` using a working npm registry
- [ ] Run `npm run verify:release`
- [ ] Open the app in Chrome and perform a real 100K-candle interaction smoke test
- [ ] Confirm the selected D1 mode matches the user's intended trading day
- [ ] Deploy as one long-running Next.js Node instance and verify cache continuity

## Release decision

Phase 1 code is ready for credential-based release verification. Do not call it fully production-verified until every item in section C passes on the user's machine/server.
