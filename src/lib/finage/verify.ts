import {
  buildFinageM1AggregateUrl,
  fetchFinageM1AggregateResponse,
  maskFinageUrl,
} from "./client";
import { getServerEnv } from "@/lib/market/env";
import { normalizeFinageAggregates } from "@/lib/market/normalize";

export interface FinageVerificationOptions {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface FinageVerificationResult {
  ok: true;
  requestedSymbol: string;
  returnedSymbol: string;
  testedFromDate: string;
  testedToDate: string;
  requestUrl: string;
  providerRecords: number;
  providerTotalResults?: number;
  validRecords: number;
  firstTimestampUtc: string;
  lastTimestampUtc: string;
}

function datePath(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function parseDatePath(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD format.`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || datePath(parsed) !== value) {
    throw new Error(`${name} is not a valid calendar date.`);
  }
  return parsed;
}

async function verifyRange(
  fromDate: string,
  toDate: string,
  limit: number,
): Promise<FinageVerificationResult | null> {
  const env = getServerEnv();
  const fromMs = parseDatePath(fromDate, "fromDate");
  const toDayMs = parseDatePath(toDate, "toDate");
  if (toDayMs < fromMs) throw new Error("toDate must be on or after fromDate.");

  // Finage's date path is calendar-date based. Include the complete `toDate`
  // only for verification normalization.
  const exactToExclusiveMs = toDayMs + 86_400_000;
  const request = {
    baseUrl: env.FINAGE_REST_BASE_URL,
    apiKey: env.FINAGE_API_KEY,
    symbol: env.FINAGE_XAUUSD_SYMBOL,
    fromDate,
    toDate,
    limit,
    timeoutMs: env.FINAGE_REQUEST_TIMEOUT_MS,
    sort: env.FINAGE_SORT === "provider_default" ? undefined : env.FINAGE_SORT,
    dateFormat:
      env.FINAGE_DATE_FORMAT === "provider_default"
        ? undefined
        : env.FINAGE_DATE_FORMAT,
  } as const;

  const response = await fetchFinageM1AggregateResponse(request);
  if (response.results.length === 0) return null;

  if (response.symbol.toUpperCase() !== env.FINAGE_XAUUSD_SYMBOL.toUpperCase()) {
    throw new Error(
      `Finage returned symbol ${response.symbol}, expected ${env.FINAGE_XAUUSD_SYMBOL}.`,
    );
  }

  const normalized = normalizeFinageAggregates(
    response.results,
    fromMs,
    exactToExclusiveMs,
  );
  if (normalized.candles.length === 0) {
    throw new Error(
      `Finage returned ${response.results.length} records for ${fromDate}..${toDate}, ` +
        "but none passed OHLC/timestamp validation.",
    );
  }

  return {
    ok: true,
    requestedSymbol: env.FINAGE_XAUUSD_SYMBOL,
    returnedSymbol: response.symbol,
    testedFromDate: fromDate,
    testedToDate: toDate,
    requestUrl: maskFinageUrl(buildFinageM1AggregateUrl(request)),
    providerRecords: response.results.length,
    providerTotalResults: response.totalResults,
    validRecords: normalized.candles.length,
    firstTimestampUtc: new Date(normalized.candles[0][0]).toISOString(),
    lastTimestampUtc: new Date(normalized.candles.at(-1)![0]).toISOString(),
  };
}

/**
 * Executes a real Finage request. An explicit range uses the exact date-path
 * contract. Without a range it searches recent dates because weekends and
 * holidays can legitimately contain no M1 records.
 */
export async function verifyFinageConnection(
  options: FinageVerificationOptions = {},
): Promise<FinageVerificationResult> {
  const env = getServerEnv();
  const limit = Math.max(
    1,
    Math.min(50_000, Math.floor(options.limit ?? 2_000)),
  );

  if (options.fromDate || options.toDate) {
    if (!options.fromDate || !options.toDate) {
      throw new Error("Both --from and --to are required for an explicit range.");
    }
    const result = await verifyRange(options.fromDate, options.toDate, limit);
    if (result) return result;
    throw new Error(
      `Finage returned no ${env.FINAGE_XAUUSD_SYMBOL} M1 records for ` +
        `${options.fromDate}..${options.toDate}. Check plan history depth and market closure.`,
    );
  }

  const now = Date.now();
  for (let daysBack = 1; daysBack <= 10; daysBack += 1) {
    const date = datePath(now - daysBack * 86_400_000);
    const result = await verifyRange(date, date, limit);
    if (result) return result;
  }

  throw new Error(
    `Finage returned no ${env.FINAGE_XAUUSD_SYMBOL} M1 records for the previous 10 calendar dates.`,
  );
}
