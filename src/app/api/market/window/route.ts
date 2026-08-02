import { z } from "zod";
import { resolveAnalysis } from "@/lib/market/analysis-recovery";
import { ANALYSIS_RECOVERY_QUERY_SHAPE } from "@/lib/market/analysis-recovery-schema";
import { getServerEnv } from "@/lib/market/env";
import { createMarketWindow } from "@/lib/market/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timeframe: z.enum(["M1", "M5", "M15", "H1", "D1"]),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(10_000).default(2_000),
  ...ANALYSIS_RECOVERY_QUERY_SHAPE,
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

  let resolved: Awaited<ReturnType<typeof resolveAnalysis>>;
  try {
    resolved = await resolveAnalysis(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recovery error.";
    return Response.json(
      { error: `Automatic serverless analysis recovery failed: ${message}` },
      { status: 502 },
    );
  }
  if (!resolved) {
    return Response.json(
      {
        error:
          "Analysis was not found and no recovery parameters were supplied. Run the analysis again.",
      },
      { status: 410 },
    );
  }
  const analysis = resolved.analysis;

  const env = getServerEnv();
  const window = createMarketWindow(
    analysis,
    parsed.data.timeframe,
    parsed.data.offset,
    parsed.data.limit,
    env.APP_MAX_WINDOW_CANDLES,
  );
  return Response.json(
    { ...window, recoveredFromSource: resolved.recovered },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Analysis-Recovered": resolved.recovered ? "true" : "false",
      },
    },
  );
}
