import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import {
  createSignalDecisionHistory,
  getOrCreateSignalDecisionIndex,
} from "@/lib/market/signal-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(5_000).default(100),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid signal-history request.", details: parsed.error.issues },
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

  const history = createSignalDecisionHistory(
    getOrCreateSignalDecisionIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    }),
    analysis.id,
    parsed.data.offset,
    parsed.data.limit,
  );

  return Response.json(history, {
    headers: {
      "Cache-Control": "no-store",
      "X-Signal-Semantics": "decision-events-not-execution-permission",
    },
  });
}
