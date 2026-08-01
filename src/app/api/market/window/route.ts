import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import { getServerEnv } from "@/lib/market/env";
import { createMarketWindow } from "@/lib/market/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timeframe: z.enum(["M1", "M5", "M15", "H1", "D1"]),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(10_000).default(2_000),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid window request.", details: parsed.error.issues },
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

  const env = getServerEnv();
  return Response.json(
    createMarketWindow(
      analysis,
      parsed.data.timeframe,
      parsed.data.offset,
      parsed.data.limit,
      env.APP_MAX_WINDOW_CANDLES,
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
