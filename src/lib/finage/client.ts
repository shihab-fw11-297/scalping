import {
  finageAggregateResponseSchema,
  finageErrorResponseSchema,
} from "./schema";
import type { FinageAggregateResponse } from "./schema";
import type { FinageRawAggregate } from "@/lib/market/types";
import { STATIC_RUNTIME_LIMITS } from "@/lib/market/static-limits";

export class FinageApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FinageApiError";
  }
}

export interface FetchFinageAggregatesParams {
  baseUrl: string;
  apiKey: string;
  symbol: string;
  fromDate: string;
  toDate: string;
  limit: number;
  timeoutMs: number;
  /** Omit to use Finage's documented provider default (ascending). */
  sort?: "asc" | "desc";
  /** Omit to use the provider-default timestamp representation. */
  dateFormat?: "ts" | "dt";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function buildFinageM1AggregateUrl(
  params: FetchFinageAggregatesParams,
): URL {
  const {
    baseUrl,
    apiKey,
    symbol,
    fromDate,
    toDate,
    limit,
    sort,
    dateFormat,
  } = params;

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) throw new FinageApiError("FINAGE_API_KEY is empty.");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST
  ) {
    throw new FinageApiError(
      `Finage limit must be an integer from 1 to ` +
        `${STATIC_RUNTIME_LIMITS.FINAGE_MAX_RESULTS_PER_REQUEST}.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new FinageApiError("Finage fromDate/toDate must use YYYY-MM-DD.");
  }

  const fromDayMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toDayMs = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromDayMs) || !Number.isFinite(toDayMs) || toDayMs < fromDayMs) {
    throw new FinageApiError("Finage toDate must be on or after fromDate.");
  }
  const inclusiveCalendarDays =
    Math.floor((toDayMs - fromDayMs) / 86_400_000) + 1;
  if (inclusiveCalendarDays > STATIC_RUNTIME_LIMITS.FINAGE_M1_REQUEST_CALENDAR_DAYS) {
    throw new FinageApiError(
      `Finage M1 requests are hard-limited to ` +
        `${STATIC_RUNTIME_LIMITS.FINAGE_M1_REQUEST_CALENDAR_DAYS} calendar days; ` +
        `received ${fromDate}..${toDate} (${inclusiveCalendarDays} days).`,
    );
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `agg/forex/${encodeURIComponent(symbol)}/1/minute/${fromDate}/${toDate}`,
    normalizedBaseUrl,
  );

  // Keep the request in Finage's documented URL shape:
  // ?apikey=...&limit=<configured-safe-limit>
  url.searchParams.set("apikey", normalizedApiKey);
  url.searchParams.set("limit", String(limit));
  if (sort) url.searchParams.set("sort", sort);
  if (dateFormat) url.searchParams.set("date_format", dateFormat);

  return url;
}

export function maskFinageUrl(url: URL): string {
  const masked = new URL(url);
  if (masked.searchParams.has("apikey")) {
    masked.searchParams.set("apikey", "***REDACTED***");
  }
  return masked.toString();
}

function toProviderMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch {
      return null;
    }
  }
  return null;
}

function providerErrorMessage(json: unknown): string | null {
  const parsed = finageErrorResponseSchema.safeParse(json);
  if (!parsed.success || !(json && typeof json === "object")) return null;

  const object = json as Record<string, unknown>;
  if (Array.isArray(object.results)) return null;

  return (
    toProviderMessage(parsed.data.error) ??
    toProviderMessage(parsed.data.message) ??
    toProviderMessage(parsed.data.status) ??
    toProviderMessage(parsed.data.code)
  );
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new FinageApiError(
      `Finage returned an empty response body (${response.status}).`,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FinageApiError(
      `Finage returned non-JSON data (${response.status}): ${text.slice(0, 240)}`,
      response.status,
    );
  }
}

/** Fetches one Finage date chunk and returns the validated provider envelope. */
export async function fetchFinageM1AggregateResponse(
  params: FetchFinageAggregatesParams,
): Promise<FinageAggregateResponse> {
  const url = buildFinageM1AggregateUrl(params);
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, params.timeoutMs);
      let json: unknown;
      try {
        json = await parseJsonBody(response);
      } catch (error) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          await delay(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
          continue;
        }
        if (error instanceof FinageApiError && response.ok) {
          throw new FinageApiError(error.message, 502);
        }
        throw error;
      }
      const providerMessage = providerErrorMessage(json);

      if (!response.ok || providerMessage) {
        const message = providerMessage ?? `HTTP ${response.status}`;

        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          await delay(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
          continue;
        }

        throw new FinageApiError(
          `Finage request failed (${response.status}): ${message.slice(0, 500)}`,
          response.ok ? 502 : response.status,
        );
      }

      const parsed = finageAggregateResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new FinageApiError(
          `Finage response validation failed: ${parsed.error.issues
            .slice(0, 8)
            .map(
              (issue: { path: PropertyKey[]; message: string }) =>
                `${issue.path.join(".")}: ${issue.message}`,
            )
            .join("; ")}`,
          502,
        );
      }

      return parsed.data;
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (attempt < maxAttempts && (isAbort || error instanceof TypeError)) {
        await delay(400 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new FinageApiError("Unknown Finage request failure.");
}

/** Fetches one Finage date chunk. Retries only transient failures (429/5xx). */
export async function fetchFinageM1Aggregates(
  params: FetchFinageAggregatesParams,
): Promise<FinageRawAggregate[]> {
  const response = await fetchFinageM1AggregateResponse(params);
  return response.results;
}
