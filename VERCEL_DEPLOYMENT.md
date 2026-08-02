# Vercel Deployment

## Included build fixes

- Build-critical TypeScript packages are in `dependencies`, so they remain available even if an environment accidentally installs production dependencies only.
- `vercel.json` forces `npm install --production=false` and `npm run build`.
- Node.js is pinned to the Vercel-supported major version `22.x`.
- `next.config.mjs` avoids requiring TypeScript to load the Next.js configuration.
- `tsconfig.build.json` limits production type checking to application source and generated Next.js route types. Tests and verification scripts remain covered by the normal `tsconfig.json` during local `npm run typecheck` and `npm test`.
- `prebuild` validates that the required build packages and deployment files exist before `next build` starts.

## Vercel settings

Use the folder containing `package.json` as the Vercel Root Directory.

- Framework preset: Next.js
- Node.js: 22.x
- Install command: `npm install --production=false`
- Build command: `npm run build`
- Output directory: leave blank/default

Do not add `NODE_ENV=production` manually in Vercel environment variables. Add `FINAGE_API_KEY` and the other required server variables from `.env.example` instead.

After updating the repository, redeploy without the previous build cache.

## Local verification

```bash
npm install --production=false
npm run verify:vercel
npm run build
```

## Runtime architecture note

The current analysis cache is process memory. Vercel Functions may recycle or distribute function instances, so cached analysis IDs are not durable across every request. Initial analysis data is returned in the analyze response, but reliable cross-request report/window history on a serverless multi-instance deployment requires an external shared cache or a single long-running Node deployment.
