# Vercel Deployment

## Included build fixes

- Build-critical TypeScript packages are in `dependencies`, so they remain available even if an environment installs production dependencies only.
- `vercel.json` forces `npm install --production=false` and `npm run build`.
- Node.js is pinned to `22.x`.
- `next.config.mjs` avoids requiring TypeScript to load the Next.js configuration.
- `tsconfig.build.json` limits production type checking to application source and generated Next.js route types.
- `prebuild` validates required build packages and deployment files before `next build` starts.

## Included serverless runtime fixes

Vercel Functions do not guarantee that `/analyze`, `/report`, `/window` and export requests use the same process. The project therefore no longer depends on process memory for correctness:

1. `/api/market/analyze` returns the complete report in the same response.
2. The browser downloads JSON/Markdown from that embedded report.
3. The analyze response includes a validated recovery descriptor containing the original period and Phase 7 assumptions.
4. Window, report, export, market-state, opportunity, signal and trade routes use the in-memory cache when available.
5. On a cache miss, those routes can rebuild the same analysis from Finage.
6. The browser caches successfully loaded timeframe windows and rejects stale responses.

A shared Redis/KV layer remains optional for reducing repeated Finage calls. It is not required to prevent the former immediate `Analysis expired or was not found` failure.

## Vercel settings

Use the folder containing `package.json` as the Vercel Root Directory.

- Framework preset: Next.js
- Node.js: 22.x
- Install command: `npm install --production=false`
- Build command: `npm run build`
- Output directory: leave blank/default

Do not add `NODE_ENV=production` manually. Add `FINAGE_API_KEY` and the other required server variables from `.env.example`. `ANALYSIS_WARMUP_CALENDAR_DAYS=30` is the recommended Medium Accuracy V1 default.

After replacing the project files, redeploy without the previous build cache.

## Local verification

```bash
npm install --production=false
npm run verify:vercel
npm run verify:serverless
npm run verify:analysis-recovery
npm run verify:medium-accuracy
npm run verify:report-signals
npm run build
```

## Runtime behaviour

- The initial complete report is available immediately after a successful fetch.
- The selected chart/report period is computed with prior warm-up context but warm-up candles remain hidden from visible totals.
- Trading view shows deduplicated Grade A/B markers; Phase 6 research markers are optional.
- The first timeframe request that lands on a different Vercel instance may rebuild from Finage and therefore take longer.
- The UI displays whether the loaded window was rebuilt.
- Returning to an already loaded timeframe/window uses current-tab browser cache.
- A Finage recovery failure is returned as a specific JSON error instead of a misleading expired-analysis message.
