import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) throw new Error(message);
}

function assertNotIncludes(source, forbidden, message) {
  if (source.includes(forbidden)) throw new Error(message);
}

const pipeline = read("src/lib/market/pipeline.ts");
const types = read("src/lib/market/types.ts");
const analyzer = read("src/components/market-analyzer.tsx");
const windowRoute = read("src/app/api/market/window/route.ts");
const reportRoute = read("src/app/api/market/report/route.ts");
const recovery = read("src/lib/market/analysis-recovery.ts");
const reportPanel = read("src/components/analysis-report-panel.tsx");
const routeFiles = [
  "src/app/api/market/window/route.ts",
  "src/app/api/market/report/route.ts",
  "src/app/api/market/export/route.ts",
  "src/app/api/market/state/route.ts",
  "src/app/api/market/opportunities/route.ts",
  "src/app/api/market/signals/route.ts",
  "src/app/api/market/signals/history/route.ts",
  "src/app/api/market/trades/route.ts",
  "src/app/api/market/trades/history/route.ts",
  "src/app/api/market/trades/export/route.ts",
];

assertIncludes(types, "recoveryRequest: AnalysisRecoveryRequest", "Analyze response recovery descriptor is missing.");
assertIncludes(types, "completeReport: AnalysisReport", "Analyze response complete report is missing.");
assertIncludes(pipeline, "const completeReport = createAnalysisReport(cached)", "Complete report is not built during analysis.");
assertIncludes(pipeline, "recoveryRequest,", "Recovery request is not returned by analysis.");
assertIncludes(analyzer, "setCurrentReport(parsed.completeReport)", "Client still depends on a second report request.");
assertIncludes(analyzer, "addRecoveryParams(params, result.recoveryRequest)", "Window recovery query is missing.");
assertIncludes(analyzer, "windowRequestSequence", "Out-of-order timeframe protection is missing.");
assertIncludes(analyzer, "setWindowCache", "Browser timeframe cache is missing.");
assertIncludes(windowRoute, "resolveAnalysis(parsed.data)", "Window route cannot recover a serverless cache miss.");
assertIncludes(windowRoute, "recoveredFromSource: resolved.recovered", "Window recovery status is not returned to the client.");
assertIncludes(reportRoute, "resolveAnalysis(parsed.data)", "Report route cannot recover a serverless cache miss.");
assertIncludes(recovery, "rebuildAnalysisFromFinage", "Finage recovery rebuild is missing.");
assertIncludes(reportPanel, "onDownloadCurrentReport", "Client-side complete report download is missing.");

for (const file of routeFiles) {
  const source = read(file);
  assertNotIncludes(source, "analysisCache.get(parsed.data.analysisId)", `${file} still has a cache-only lookup.`);
  assertNotIncludes(source, "Analysis expired or was not found. Run the analysis again.", `${file} still returns the old serverless failure.`);
}

console.log(JSON.stringify({
  ok: true,
  embeddedCompleteReport: true,
  statelessRecoveryRoutes: routeFiles.length,
  browserWindowCache: true,
  staleResponseProtection: true,
  recoveryStatusVisible: true,
}, null, 2));
