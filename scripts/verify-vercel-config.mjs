import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const failures = [];

const requiredRuntimeDependencies = [
  "next",
  "react",
  "react-dom",
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
];

for (const name of requiredRuntimeDependencies) {
  if (!pkg.dependencies?.[name]) {
    failures.push(`${name} must be declared in dependencies for production-safe Vercel builds.`);
  }
}

if (pkg.engines?.node !== "22.x") {
  failures.push('package.json engines.node must be "22.x".');
}

if (!existsSync(new URL("../tsconfig.build.json", import.meta.url))) {
  failures.push("tsconfig.build.json is missing.");
}
if (!existsSync(new URL("../next.config.mjs", import.meta.url))) {
  failures.push("next.config.mjs is missing.");
}
if (!existsSync(new URL("../vercel.json", import.meta.url))) {
  failures.push("vercel.json is missing.");
}

for (const name of ["next", "typescript", "react", "react-dom"]) {
  try {
    require.resolve(`${name}/package.json`);
  } catch {
    failures.push(`${name} is not installed. Run npm install --production=false.`);
  }
}

if (failures.length > 0) {
  console.error("Vercel build preflight failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Vercel build preflight passed.");
