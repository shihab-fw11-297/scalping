import { verifyFinageConnection } from "../src/lib/finage/verify";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

const fromDate = argument("from");
const toDate = argument("to");
const rawLimit = argument("limit");
const limit = rawLimit === undefined ? undefined : Number(rawLimit);

if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50_000)) {
  console.error("--limit must be an integer from 1 to 50000.");
  process.exitCode = 1;
} else {
  try {
    const result = await verifyFinageConnection({ fromDate, toDate, limit });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
