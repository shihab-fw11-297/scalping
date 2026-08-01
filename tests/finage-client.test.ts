import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFinageM1AggregateUrl,
  fetchFinageM1AggregateResponse,
  FinageApiError,
  maskFinageUrl,
} from "@/lib/finage/client";

const baseParams = {
  baseUrl: "https://api.finage.co.uk",
  apiKey: "test-key",
  symbol: "XAUUSD",
  fromDate: "2026-07-25",
  toDate: "2026-08-01",
  limit: 50_000,
  timeoutMs: 1_000,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Finage REST contract", () => {
  it("builds the provider-default URL in the exact documented shape", () => {
    const url = buildFinageM1AggregateUrl(baseParams);
    expect(url.pathname).toBe("/agg/forex/XAUUSD/1/minute/2026-07-25/2026-08-01");
    expect(url.searchParams.get("apikey")).toBe("test-key");
    expect(url.searchParams.get("limit")).toBe("50000");
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.has("date_format")).toBe(false);
    expect(maskFinageUrl(url)).not.toContain("test-key");
  });

  it("adds explicit provider options only when configured", () => {
    const url = buildFinageM1AggregateUrl({
      ...baseParams,
      sort: "asc",
      dateFormat: "ts",
    });
    expect(url.searchParams.get("sort")).toBe("asc");
    expect(url.searchParams.get("date_format")).toBe("ts");
  });

  it("accepts a valid provider response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      symbol: "XAUUSD",
      totalResults: 1,
      results: [{ o: 2600, h: 2601, l: 2599, c: 2600.5, v: 10, t: 1767225600000 }],
    }), { status: 200 })));

    const result = await fetchFinageM1AggregateResponse(baseParams);
    expect(result.symbol).toBe("XAUUSD");
    expect(result.results).toHaveLength(1);
  });

  it("coerces numeric-string OHLCV and totalResults values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      symbol: "XAUUSD",
      totalResults: "1",
      results: [{ o: "2600", h: "2601", l: "2599", c: "2600.5", v: "10", t: "2026-07-27T10:00:00Z" }],
    }), { status: 200 })));

    const result = await fetchFinageM1AggregateResponse(baseParams);
    expect(result.totalResults).toBe(1);
    expect(result.results[0].o).toBe(2600);
    expect(result.results[0].v).toBe(10);
  });

  it("surfaces a provider error returned with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Your plan does not include this historical range.",
    }), { status: 200 })));

    await expect(fetchFinageM1AggregateResponse(baseParams)).rejects.toThrow(
      "Your plan does not include this historical range",
    );
  });

  it("rejects malformed provider data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      symbol: "XAUUSD",
      results: [{ o: "bad" }],
    }), { status: 200 })));

    await expect(fetchFinageM1AggregateResponse(baseParams)).rejects.toBeInstanceOf(
      FinageApiError,
    );
  });
});
