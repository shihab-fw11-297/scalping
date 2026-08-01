import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import { createAnalysisReport, createAnalysisReportMarkdown } from "@/lib/market/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  format: z.enum(["json", "md"]).default("json"),
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

  const analysis = analysisCache.get(parsed.data.analysisId);
  if (!analysis) {
    return Response.json(
      { error: "Analysis expired or was not found. Run the analysis again." },
      { status: 410 },
    );
  }

  const report = createAnalysisReport(analysis);
  const period = `${safeName(report.summary.requestedFromUtc)}_${safeName(report.summary.requestedToUtc)}`;
  if (parsed.data.format === "md") {
    return new Response(createAnalysisReportMarkdown(report), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="xauusd-report_${period}.md"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify(report), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="xauusd-report_${period}.json"`,
      "Cache-Control": "no-store",
      "X-Report-Semantics": "historical-analysis-not-profitability-proof",
    },
  });
}
