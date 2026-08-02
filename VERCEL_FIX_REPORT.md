# Vercel Build Fix Report

## Reported failure

The production build compiled the Next.js application and then failed during TypeScript setup because the installed dependency set did not contain `typescript`.

## Root causes found in the package

1. `typescript`, `@types/node`, `@types/react`, and `@types/react-dom` were only in `devDependencies`.
2. The archive had no lockfile or Vercel install override.
3. A production-mode dependency install could therefore omit the TypeScript build toolchain.
4. The main `tsconfig.json` included tests and scripts in the Next.js production type-check scope, creating a likely second deployment failure if `vitest` or `tsx` were omitted.
5. `next.config.ts` unnecessarily required TypeScript-aware config loading before application type checking.
6. A generated `tsconfig.tsbuildinfo` file was included in the archive.

## Fixes applied

- Moved the complete Next.js build toolchain to `dependencies`.
- Pinned TypeScript to `5.9.3`.
- Pinned the Vercel Node.js major to `22.x`.
- Added `vercel.json` with `npm install --production=false` and `npm run build`.
- Added `.npmrc` with production-only installation disabled.
- Replaced `next.config.ts` with `next.config.mjs`.
- Added `tsconfig.build.json`, restricted to `src/` and generated Next.js types.
- Configured Next.js to use `tsconfig.build.json` during production builds.
- Added a dependency/configuration prebuild check.
- Removed generated TypeScript build state and ignored future `*.tsbuildinfo` files.
- Added deployment instructions and cache/runtime limitations.

## Validation completed

- All JSON configuration files parsed successfully.
- `next.config.mjs` syntax passed.
- Vercel preflight script syntax passed.
- All 49 TypeScript/TSX source files transpiled successfully.
- Production-source semantic type checking passed using temporary external-package declarations.
- Production build scope excludes `tests/` and `scripts/`.
- Build-critical packages are present in `dependencies`.
- Vercel install and build commands match the intended npm deployment flow.
- API key scan passed; no user Finage key was stored.

## External verification still required

This environment's internal npm registry does not provide TypeScript and direct public-registry access timed out, so a real dependency installation and `next build` could not be run here. Run this in the extracted project or let Vercel perform it:

```bash
npm install --production=false
npm run verify:vercel
npm run build
```

Redeploy on Vercel without the old build cache.
