# Static Finage and Candle Limits

The application no longer reads request/candle limits from environment variables.

Edit only this file:

```text
src/lib/market/static-limits.ts
```

Current compiled values:

```ts
FINAGE_MAX_RESULTS_PER_REQUEST: 50_000
APP_MAX_CANDLES: 100_000
APP_MAX_WINDOW_CANDLES: 5_000
```

`FINAGE_API_KEY` still comes from `.env.local` or Vercel Environment Variables. Do not commit an API key into source code.

After changing a static limit, restart the local server or redeploy Vercel so the application is rebuilt.
