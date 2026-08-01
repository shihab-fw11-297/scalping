# Finage Historical Fetch Fix

## Correct default request

```text
https://api.finage.co.uk/agg/forex/XAUUSD/1/minute/2026-07-25/2026-08-01?apikey=<SERVER_KEY>&limit=50000
```

The application now generates this provider-default shape. It does not append
`sort` or `date_format` unless configured.

## Environment

```env
FINAGE_API_KEY=your_key_value_only
FINAGE_REST_BASE_URL=https://api.finage.co.uk
FINAGE_XAUUSD_SYMBOL=XAUUSD
FINAGE_REQUEST_TIMEOUT_MS=30000
FINAGE_FETCH_CONCURRENCY=2
FINAGE_SORT=provider_default
FINAGE_DATE_FORMAT=provider_default
FINAGE_MAX_RESULTS_PER_REQUEST=50000
```

Do not set `FINAGE_API_KEY` to a full URL and do not include `apikey=`.

## Exact verification

```bash
npm run verify:finage -- --from=2026-07-25 --to=2026-08-01 --limit=50000
```

Successful output contains:

- `ok: true`
- returned symbol `XAUUSD`
- provider/valid record counts
- first and last UTC timestamps
- masked request URL

## Compatibility improvements

- provider-default date format
- optional explicit `ts` or `dt`
- numeric and numeric-string OHLCV
- numeric or string timestamp
- HTTP-200 error-envelope detection
- empty/non-JSON response diagnostics
- transient retry for 429 and 5xx responses
- exact no-secret URL diagnostics

## Security

Never commit `.env.local`. Rotate any API key that was pasted into a public or
shared chat, ticket, screenshot, repository, or log.
