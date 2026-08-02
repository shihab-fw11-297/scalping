import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const staticPath = path.join(root, "src/lib/market/static-limits.ts");
const envPath = path.join(root, "src/lib/market/env.ts");
const pipelinePath = path.join(root, "src/lib/market/pipeline.ts");
const windowPath = path.join(root, "src/app/api/market/window/route.ts");

for (const file of [staticPath, envPath, pipelinePath, windowPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const staticSource = fs.readFileSync(staticPath, "utf8");
const envSource = fs.readFileSync(envPath, "utf8");
const pipelineSource = fs.readFileSync(pipelinePath, "utf8");
const windowSource = fs.readFileSync(windowPath, "utf8");

const required = [
  "FINAGE_MAX_RESULTS_PER_REQUEST: 50_000",
  "APP_MAX_CANDLES: 100_000",
  "APP_MAX_WINDOW_CANDLES: 5_000",
];
for (const snippet of required) {
  if (!staticSource.includes(snippet)) {
    throw new Error(`Static limit is missing or changed unexpectedly: ${snippet}`);
  }
}

for (const name of [
  "FINAGE_MAX_RESULTS_PER_REQUEST",
  "APP_MAX_CANDLES",
  "APP_MAX_WINDOW_CANDLES",
]) {
  if (envSource.includes(name)) {
    throw new Error(`${name} must not be declared in env.ts.`);
  }
}

if (!pipelineSource.includes("STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST")) {
  throw new Error("Pipeline is not using the static Finage request limit.");
}
if (!pipelineSource.includes("STATIC_RUNTIME_LIMITS.APP_MAX_CANDLES")) {
  throw new Error("Pipeline is not using the static analysis candle limit.");
}
if (!pipelineSource.includes("STATIC_RUNTIME_LIMITS.APP_MAX_WINDOW_CANDLES")) {
  throw new Error("Pipeline is not using the static window limit.");
}
if (!windowSource.includes("STATIC_RUNTIME_LIMITS.APP_MAX_WINDOW_CANDLES")) {
  throw new Error("Window route is not using the static window limit.");
}

console.log("Static Finage/runtime limits verification passed.");
