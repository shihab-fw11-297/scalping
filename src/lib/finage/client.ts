import {
  finageAggregateResponseSchema,
  finageErrorResponseSchema,
} from "./schema";
import type { FinageAggregateResponse } from "./schema";
import type { FinageRawAggregate } from "@/lib/market/types";

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

function logFinageMessage(message: string): void {
  console.log(`[Finage] ${message}`);
}

function logFinageRequest(url: URL, attempt: number): void {
  logFinageMessage(`Request attempt ${attempt}: ${maskFinageUrl(url)}`);
}

function logFinageResponse(url: URL, attempt: number, response: Response, durationMs: number): void {
  const contentType = response.headers.get("content-type") ?? "<no content-type>";
  logFinageMessage(
    `Response attempt ${attempt}: ${maskFinageUrl(url)} ${response.status} ${response.statusText} ${contentType} ${durationMs}ms`,
  );
}

function logFinageRetry(url: URL, attempt: number, status: number, reason: string): void {
  logFinageMessage(`Retrying attempt ${attempt} for ${maskFinageUrl(url)}: status=${status}, reason=${reason}`);
}

function logFinageError(url: URL, attempt: number, error: Error): void {
  logFinageMessage(`Error attempt ${attempt}: ${maskFinageUrl(url)} ${error.name}: ${error.message}`);
}

async function fetchWithTimeout(url: URL, timeoutMs: number, attempt: number): Promise<Response> {
  logFinageRequest(url, attempt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const durationMs = Date.now() - startTime;
    logFinageResponse(url, attempt, response, durationMs);
    return response;
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
  if (!Number.isInteger(limit) || limit < 1 || limit > 50_000) {
    throw new FinageApiError("Finage limit must be an integer from 1 to 50000.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new FinageApiError("Finage fromDate/toDate must use YYYY-MM-DD.");
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `agg/forex/${encodeURIComponent(symbol)}/1/minute/${fromDate}/${toDate}`,
    normalizedBaseUrl,
  );

  // Keep the default request identical to Finage's documented URL shape:
  // ?apikey=...&limit=50000
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

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const looksLikeHtml = text.trimStart().startsWith("<");
  if (contentType.includes("text/html") || looksLikeHtml) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
    throw new FinageApiError(
      `Finage returned non-JSON data (${response.status}${statusText}): ${snippet}`,
      response.status,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FinageApiError(
      `Finage returned non-JSON JSON data (${response.status}): ${text.slice(0, 240)}`,
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
      const response = await fetchWithTimeout(url, params.timeoutMs, attempt);
      let json: unknown;
      try {
        json = await parseJsonBody(response);
      } catch (error) {
        if (error instanceof Error) {
          logFinageError(url, attempt, error);
        }

        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          logFinageRetry(url, attempt, response.status, error instanceof Error ? error.message : "transient failure");
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
