import { z } from "zod";
import { resolveAnalysis } from "@/lib/market/analysis-recovery";
import { ANALYSIS_RECOVERY_QUERY_SHAPE } from "@/lib/market/analysis-recovery-schema";
import { createAnalysisReport, createAnalysisReportMarkdown } from "@/lib/market/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  format: z.enum(["json", "md"]).default("json"),
  ...ANALYSIS_RECOVERY_QUERY_SHAPE,
});

function safeName(value: string): string {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid report request.", details: parsed.error.issues },
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

  const report = createAnalysisReport(analysis);
  const period = `${safeName(report.summary.requestedFromUtc)}_${safeName(report.summary.requestedToUtc)}`;
  if (parsed.data.format === "md") {
    return new Response(createAnalysisReportMarkdown(report), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="xauusd-report_${period}.md"`,
        "Cache-Control": "no-store",
        "X-Analysis-Recovered": resolved.recovered ? "true" : "false",
      },
    });
  }

  return new Response(JSON.stringify(report), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="xauusd-report_${period}.json"`,
      "Cache-Control": "no-store",
      "X-Report-Semantics": "historical-analysis-not-profitability-proof",
      "X-Analysis-Recovered": resolved.recovered ? "true" : "false",
    },
  });
}
