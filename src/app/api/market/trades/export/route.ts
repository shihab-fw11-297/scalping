import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import {
  createTradePlanHistory,
  getOrCreateTradeManagementIndex,
} from "@/lib/market/trade-management";
import type { TradePlanHistoryItem } from "@/lib/market/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  analysisId: z.string().uuid(),
  format: z.enum(["csv", "json"]).default("csv"),
});

const encoder = new TextEncoder();

function streamGenerator(generator: Generator<string>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = generator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      generator.return?.(undefined);
    },
  });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function targetPrice(item: TradePlanHistoryItem, name: "TP1" | "TP2" | "TP3"): number | null {
  return item.targetSpace.targets.find((target) => target.name === name)?.price ?? null;
}

function* csvChunks(
  analysisId: string,
  index: ReturnType<typeof getOrCreateTradeManagementIndex>,
): Generator<string> {
  yield [
    "analysisId",
    "signalTimestampUtc",
    "enteredTimestampUtc",
    "planId",
    "family",
    "direction",
    "action",
    "finalStatus",
    "finalHealth",
    "candidateScore",
    "entryZoneLow",
    "preferredEntry",
    "entryZoneHigh",
    "actualEntryPrice",
    "noChasePrice",
    "expiryUtc",
    "structuralInvalidation",
    "initialStopLoss",
    "riskDistance",
    "totalRiskWithCosts",
    "nearestObstacle",
    "nearestObstacleSource",
    "targetLimitingFactor",
    "availableDistance",
    "availableRiskReward",
    "tp1",
    "tp1RiskReward",
    "tp2",
    "tp3",
    "expected5MinuteDistance",
    "expected10MinuteDistance",
    "expectedFirstProgressBars",
    "mfe",
    "mae",
    "highestTargetHit",
    "assumedSpread",
    "assumedSlippage",
    "reasons",
    "rejectionReasons",
    "limitations",
    "semantics",
  ].join(",") + "\n";

  const batchSize = 1_000;
  for (let offset = 0; offset < index.summary.createdPlanCount; offset += batchSize) {
    const history = createTradePlanHistory(index, analysisId, offset, batchSize, batchSize);
    const rows = history.items.map((item) => {
      const tp1 = item.targetSpace.targets.find((target) => target.name === "TP1") ?? null;
      return [
        analysisId,
        new Date(item.signalTimestampMs).toISOString(),
        item.enteredAtMs === null ? "" : new Date(item.enteredAtMs).toISOString(),
        item.planId,
        item.family,
        item.direction,
        item.action,
        item.status,
        item.finalHealth,
        item.candidateScore,
        item.entryZone.lower,
        item.entryZone.preferred,
        item.entryZone.upper,
        item.entryPrice,
        item.entryZone.noChasePrice,
        new Date(item.entryZone.expiresAtMs).toISOString(),
        item.structuralRisk.invalidationPrice,
        item.structuralRisk.stopLossPrice,
        item.structuralRisk.riskDistance,
        item.structuralRisk.totalRiskWithCosts,
        item.targetSpace.nearestObstaclePrice,
        item.targetSpace.nearestObstacleSource,
        item.targetSpace.limitingFactor,
        item.targetSpace.availableDistance,
        item.targetSpace.availableRiskReward,
        targetPrice(item, "TP1"),
        tp1?.riskReward ?? null,
        targetPrice(item, "TP2"),
        targetPrice(item, "TP3"),
        item.expectedMovement.expected5MinuteDistance,
        item.expectedMovement.expected10MinuteDistance,
        item.expectedMovement.expectedFirstProgressBars,
        item.maximumFavourableExcursion,
        item.maximumAdverseExcursion,
        item.highestTargetHit,
        item.executionCosts.assumedSpreadPrice,
        item.executionCosts.assumedSlippagePrice,
        item.reasons,
        item.rejectionReasons,
        item.limitations,
        item.semantics,
      ].map(csvEscape).join(",");
    });
    if (rows.length > 0) yield `${rows.join("\n")}\n`;
  }
}

function* jsonChunks(
  analysisId: string,
  index: ReturnType<typeof getOrCreateTradeManagementIndex>,
): Generator<string> {
  const prefix = JSON.stringify({
    analysisId,
    settings: index.settings,
    summary: index.summary,
    semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION",
  }).slice(0, -1);
  yield `${prefix},"items":[`;
  let wrote = false;
  const batchSize = 1_000;
  for (let offset = 0; offset < index.summary.createdPlanCount; offset += batchSize) {
    const items = createTradePlanHistory(index, analysisId, offset, batchSize, batchSize).items;
    const body = JSON.stringify(items).slice(1, -1);
    if (body.length > 0) {
      yield `${wrote ? "," : ""}${body}`;
      wrote = true;
    }
  }
  yield "]}";
}

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid trade-plan export request." }, { status: 400 });
  }

  const analysis = analysisCache.get(parsed.data.analysisId);
  if (!analysis) {
    return Response.json(
      { error: "Analysis expired or was not found. Run the analysis again." },
      { status: 410 },
    );
  }

  const index = getOrCreateTradeManagementIndex(analysis.datasets, {
    dailyBoundaryMode: analysis.meta.dailyBoundaryMode,
    settings: analysis.meta.tradeManagementSettings,
  });
  const baseName = `XAUUSD-trade-plans-${analysis.meta.requestedFromUtc.slice(0, 10)}`;
  const isJson = parsed.data.format === "json";

  return new Response(
    streamGenerator(isJson ? jsonChunks(analysis.id, index) : csvChunks(analysis.id, index)),
    {
      headers: {
        "Content-Type": isJson ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.${isJson ? "json" : "csv"}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
