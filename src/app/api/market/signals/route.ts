import { z } from "zod";
import { resolveAnalysis } from "@/lib/market/analysis-recovery";
import { ANALYSIS_RECOVERY_QUERY_SHAPE } from "@/lib/market/analysis-recovery-schema";
import {
  analyzeSignalDecisionAt,
  getOrCreateSignalDecisionIndex,
} from "@/lib/market/signal-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timestampMs: z.coerce.number().int().positive().optional(),
  originTimeframe: z.enum(["M1", "M5", "M15"]).optional(),
  ...ANALYSIS_RECOVERY_QUERY_SHAPE,
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid signal-decision request.", details: parsed.error.issues },
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

  const anchorTimestampMs = parsed.data.timestampMs ?? Date.parse(analysis.meta.requestedToUtc);
  const snapshot = analyzeSignalDecisionAt(
    getOrCreateSignalDecisionIndex(analysis.datasets, {
      dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    }),
    anchorTimestampMs,
  );

  if (!snapshot) {
    return Response.json(
      { error: "No closed M1 candle exists at or before the requested timestamp." },
      { status: 404 },
    );
  }

  const nativeSignals = analysis.phase12.signals
    .filter((signal) => signal.timestampMs <= anchorTimestampMs)
    .filter((signal) => !parsed.data.originTimeframe || signal.originTimeframe === parsed.data.originTimeframe)
    .slice(-100);

  return Response.json(
    {
      analysisId: analysis.id,
      requestedTimestampMs: anchorTimestampMs,
      snapshot,
      phase12: {
        architecture: analysis.phase12.architecture,
        timeframeSummaries: analysis.phase12.timeframeSummaries,
        nativeSignals,
      },
      semantics:
        "The legacy snapshot is M1-driven. phase12.nativeSignals contains independent M1, M5 and M15 signal origins with explicit execution, confirmation and bias timeframes.",
    },
    { headers: { "Cache-Control": "no-store", "X-Analysis-Recovered": resolved.recovered ? "true" : "false" } },
  );
}
