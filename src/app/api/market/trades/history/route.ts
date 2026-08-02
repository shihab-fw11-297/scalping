import { z } from "zod";
import { resolveAnalysis } from "@/lib/market/analysis-recovery";
import { ANALYSIS_RECOVERY_QUERY_SHAPE } from "@/lib/market/analysis-recovery-schema";
import {
  createTradePlanHistory,
  getOrCreateTradeManagementIndex,
} from "@/lib/market/trade-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  ...ANALYSIS_RECOVERY_QUERY_SHAPE,
});

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid trade-history request.", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const resolved = await resolveAnalysis(parsed.data);
  if (!resolved) {
    return Response.json(
      { error: "Analysis was not found and no recovery parameters were supplied." },
      { status: 410 },
    );
  }
  const analysis = resolved.analysis;
  const history = createTradePlanHistory(
    getOrCreateTradeManagementIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
      settings: analysis.meta.tradeManagementSettings,
    }),
    analysis.id,
    parsed.data.offset,
    parsed.data.limit,
  );
  return Response.json(history, {
    headers: {
      "Cache-Control": "no-store",
      "X-Analysis-Recovered": resolved.recovered ? "true" : "false",
    },
  });
}
