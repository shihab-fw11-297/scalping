import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const analyzer = readFileSync(resolve(root, "src/components/market-analyzer.tsx"), "utf8");
const report = readFileSync(resolve(root, "src/components/analysis-report-panel.tsx"), "utf8");
const table = readFileSync(resolve(root, "src/components/data-table.tsx"), "utf8");
const audit = JSON.parse(readFileSync(resolve(root, "RESPONSIVE_VIEWPORT_AUDIT.json"), "utf8"));

const checks = [
  ["wide-screen breakpoint", css.includes("@media (min-width: 1600px)")],
  ["tablet breakpoint", css.includes("@media (max-width: 980px)")],
  ["mobile breakpoint", css.includes("@media (max-width: 560px)")],
  ["small-phone breakpoint", css.includes("@media (max-width: 340px)")],
  ["landscape-height handling", css.includes("orientation: landscape")],
  ["reduced-motion support", css.includes("prefers-reduced-motion")],
  ["root horizontal-overflow protection", css.includes("overflow-x: clip")],
  ["touch-size controls", css.includes("min-height: 44px")],
  ["scrollable timeframe tabs", css.includes(".tabs") && css.includes("overflow-x: auto")],
  ["adaptive chart height", css.includes("height: clamp(360px, 62vh, 680px)")],
  ["scrollable data table", css.includes(".table-wrap table") && css.includes("min-width: 2700px")],
  ["sticky UTC table column", css.includes(".table-wrap th:first-child") && css.includes("position: sticky")],
  ["responsive analysis submit", analyzer.includes('className="analysis-submit"')],
  ["responsive chart toolbar", analyzer.includes('className="toolbar chart-toolbar"')],
  ["responsive marker actions", analyzer.includes('className="actions marker-actions"')],
  ["responsive report actions", report.includes('className="actions report-download-actions"')],
  ["accessible table region", table.includes('role="region"') && table.includes("tabIndex={0}")],
  ["mobile table guidance", table.includes("table-scroll-hint")],
  ["all recorded viewport audits passed", Array.isArray(audit) && audit.length >= 8 && audit.every((item) => item.passed === true)],
  ["no viewport root overflow", audit.every((item) => item.rootOverflow <= 1)],
  ["minimum touch height verified", audit.every((item) => item.minControlHeight >= 44)],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}
if (failed.length > 0) {
  process.exitCode = 1;
  throw new Error(`Responsive verification failed: ${failed.map(([name]) => name).join(", ")}`);
}

console.log(`Responsive verification passed for ${audit.length} recorded viewports.`);
