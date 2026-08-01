import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import {
  createTradePlanHistory,
  getOrCreateTradeManagementIndex,
} from "@/lib/market/trade-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
});

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid trade-history request.", details: parsed.error.issues },
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
  const history = createTradePlanHistory(
    getOrCreateTradeManagementIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
      settings: analysis.meta.tradeManagementSettings,
    }),
    analysis.id,
    parsed.data.offset,
    parsed.data.limit,
  );
  return Response.json(history, { headers: { "Cache-Control": "no-store" } });
}
