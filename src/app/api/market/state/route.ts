import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import {
  analyzeMultiTimeframeStateAt,
  getOrCreateMultiTimeframeStateIndex,
} from "@/lib/market/multi-timeframe-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timestampMs: z.coerce.number().int().positive().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid market-state request.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const analysis = analysisCache.get(parsed.data.analysisId);
  if (!analysis) {
    return Response.json(
      { error: "Analysis expired or was not found. Run the analysis again." },
      { status: 410 },
    );
  }

  const anchorTimestampMs = parsed.data.timestampMs ?? Date.parse(analysis.meta.requestedToUtc);
  const state = analyzeMultiTimeframeStateAt(
    getOrCreateMultiTimeframeStateIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    }),
    anchorTimestampMs,
  );

  if (!state) {
    return Response.json(
      { error: "No closed M1 candle exists at or before the requested timestamp." },
      { status: 404 },
    );
  }

  return Response.json(
    {
      analysisId: analysis.id,
      requestedTimestampMs: anchorTimestampMs,
      state,
      semantics: "Every higher-timeframe layer uses only candles closed by the synchronized M1 anchor.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
