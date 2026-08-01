import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import {
  analyzeTradeManagementAt,
  getOrCreateTradeManagementIndex,
} from "@/lib/market/trade-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timestampMs: z.coerce.number().int().positive().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid trade-plan request.", details: parsed.error.issues },
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
  const timestampMs = parsed.data.timestampMs ?? Date.parse(analysis.meta.requestedToUtc);
  const snapshot = analyzeTradeManagementAt(
    getOrCreateTradeManagementIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
      settings: analysis.meta.tradeManagementSettings,
    }),
    timestampMs,
  );
  if (!snapshot) {
    return Response.json(
      { error: "No Phase 7 trade plan exists at or before the requested timestamp." },
      { status: 404 },
    );
  }
  return Response.json(
    {
      analysisId: analysis.id,
      requestedTimestampMs: timestampMs,
      snapshot,
      semantics: "Candle-data-qualified analytical plan. Live bid/ask, spread, slippage, broker contract and order execution are not verified.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
