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

  return Response.json(
    {
      analysisId: analysis.id,
      requestedTimestampMs: anchorTimestampMs,
      snapshot,
      semantics:
        "CONFIRMED and CONTINUATION are deterministic directional decisions. Use /api/market/trades for the Phase 7 analytical entry, stop, target and qualification result.",
    },
    { headers: { "Cache-Control": "no-store", "X-Analysis-Recovered": resolved.recovered ? "true" : "false" } },
  );
}
