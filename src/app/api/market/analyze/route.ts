import { z } from "zod";
import { analyzeHistoricalMarket } from "@/lib/market/pipeline";
import { FinageApiError } from "@/lib/finage/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  fromUtc: z.iso.datetime(),
  toUtc: z.iso.datetime(),
  assumedSpreadPrice: z.number().min(0).max(20).default(0.25),
  assumedSlippagePrice: z.number().min(0).max(20).default(0.1),
  minimumRiskReward: z.number().min(1).max(10).default(1.5),
  maximumRiskInAverageRanges: z.number().min(0.5).max(10).default(3.5),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const result = await analyzeHistoricalMarket(parsed.data);
    return Response.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    const status = error instanceof FinageApiError ? error.status ?? 502 : 500;
    return Response.json({ error: message }, { status });
  }
}
