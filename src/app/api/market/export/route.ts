import { z } from "zod";
import { analysisCache } from "@/lib/market/analysis-cache";
import { analyzeCandleBehaviourWindow } from "@/lib/market/behaviour";
import { analyzePriceBehaviourWindow } from "@/lib/market/price-behaviour";
import type {
  CandleCompleteness,
  CompactCandle,
  Timeframe,
} from "@/lib/market/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  analysisId: z.string().uuid(),
  timeframe: z.enum(["M1", "M5", "M15", "H1", "D1"]),
  format: z.enum(["csv", "json"]).default("csv"),
});

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function streamGenerator(generator: Generator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
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

function jsonArrayBody(items: readonly unknown[], hasPrevious: boolean): string {
  const json = JSON.stringify(items).slice(1, -1);
  return json.length > 0 ? `${hasPrevious ? "," : ""}${json}` : "";
}

function* createJsonChunks(payload: {
  analysisId: string;
  meta: unknown;
  quality: unknown;
  timeframe: Timeframe;
  behaviourSummary: unknown;
  priceBehaviourSummary: unknown;
  marketStateSummary: unknown;
  latestMarketState: unknown;
  hypothesisOpportunitySummary: unknown;
  latestHypothesisOpportunity: unknown;
  signalDecisionSummary: unknown;
  latestSignalDecision: unknown;
  tradeManagementSummary: unknown;
  latestTradePlan: unknown;
  candles: readonly CompactCandle[];
  completeness: readonly CandleCompleteness[];
}): Generator<string> {
  const batchSize = 2_000;
  const prefix = JSON.stringify({
    analysisId: payload.analysisId,
    meta: payload.meta,
    quality: payload.quality,
    timeframe: payload.timeframe,
    behaviourSummary: payload.behaviourSummary,
    priceBehaviourSummary: payload.priceBehaviourSummary,
    marketStateSummary: payload.marketStateSummary,
    latestMarketState: payload.latestMarketState,
    hypothesisOpportunitySummary: payload.hypothesisOpportunitySummary,
    latestHypothesisOpportunity: payload.latestHypothesisOpportunity,
    signalDecisionSummary: payload.signalDecisionSummary,
    latestSignalDecision: payload.latestSignalDecision,
    tradeManagementSummary: payload.tradeManagementSummary,
    latestTradePlan: payload.latestTradePlan,
  }).slice(0, -1);

  yield `${prefix},"candles":[`;
  let wrote = false;
  for (let offset = 0; offset < payload.candles.length; offset += batchSize) {
    const body = jsonArrayBody(payload.candles.slice(offset, offset + batchSize), wrote);
    if (body) {
      yield body;
      wrote = true;
    }
  }

  yield `],"completeness":[`;
  wrote = false;
  for (let offset = 0; offset < payload.completeness.length; offset += batchSize) {
    const body = jsonArrayBody(payload.completeness.slice(offset, offset + batchSize), wrote);
    if (body) {
      yield body;
      wrote = true;
    }
  }

  yield `],"candleBehaviours":[`;
  wrote = false;
  for (let offset = 0; offset < payload.candles.length; offset += batchSize) {
    const end = Math.min(payload.candles.length, offset + batchSize);
    const batch = analyzeCandleBehaviourWindow(payload.candles, offset, end - offset);
    const body = jsonArrayBody(batch, wrote);
    if (body) {
      yield body;
      wrote = true;
    }
  }

  yield `],"priceBehaviours":[`;
  wrote = false;
  for (let offset = 0; offset < payload.candles.length; offset += batchSize) {
    const end = Math.min(payload.candles.length, offset + batchSize);
    const batch = analyzePriceBehaviourWindow(payload.candles, offset, end - offset);
    const body = jsonArrayBody(batch, wrote);
    if (body) {
      yield body;
      wrote = true;
    }
  }
  yield "]}";
}

const CSV_HEADER =
  "timestampUtc,open,high,low,close,volume,actualChildren,expectedChildren,fullIntervalChildren,expectedClosedChildren,completenessPercent,coverageStatus,direction,range,body,upperWick,lowerWick,bodyToRange,closeLocation,rangeVsAverage20,overlapPrevious,breakBehaviour,primaryTag,tags,intensityScore,maxHighBreakLookback,maxLowBreakLookback,pricePhase,efficiency5,efficiency20,noiseScore,impulseDirection,impulseStrength,impulseBars,pullbackDepthPercent,pullbackBars,recoverySpeedRatio,breakAcceptanceState,breakLevel,breakLookback,momentumCondition,accelerationRatio,extensionVsAverageRange20,freshnessScore,lateEntryRisk\n";

function* createCsvChunks(
  candles: readonly CompactCandle[],
  completenessItems: readonly CandleCompleteness[],
): Generator<string> {
  const batchSize = 2_000;
  yield CSV_HEADER;

  for (let offset = 0; offset < candles.length; offset += batchSize) {
    const end = Math.min(candles.length, offset + batchSize);
    const behaviours = analyzeCandleBehaviourWindow(candles, offset, end - offset);
    const priceBehaviours = analyzePriceBehaviourWindow(candles, offset, end - offset);
    const rows: string[] = [];

    for (let index = offset; index < end; index += 1) {
      const candle = candles[index];
      const completeness = completenessItems[index];
      const behaviour = behaviours[index - offset];
      const priceBehaviour = priceBehaviours[index - offset];
      rows.push(
        [
          new Date(candle[0]).toISOString(),
          ...candle.slice(1),
          completeness.actualChildren,
          completeness.expectedChildren,
          completeness.fullIntervalChildren,
          completeness.expectedClosedChildren,
          completeness.completenessPercent,
          completeness.status,
          behaviour.direction,
          behaviour.range,
          behaviour.body,
          behaviour.upperWick,
          behaviour.lowerWick,
          behaviour.bodyToRange,
          behaviour.closeLocation,
          behaviour.rangeVsAverage20 ?? "",
          behaviour.overlapWithPrevious ?? "",
          behaviour.breakBehaviour,
          behaviour.primaryTag,
          behaviour.tags.join("|"),
          behaviour.intensityScore,
          behaviour.maximumHighBreakLookback,
          behaviour.maximumLowBreakLookback,
          priceBehaviour.phase,
          priceBehaviour.efficiency5,
          priceBehaviour.efficiency20,
          priceBehaviour.noiseScore,
          priceBehaviour.impulseDirection,
          priceBehaviour.impulseStrength,
          priceBehaviour.impulseBars,
          priceBehaviour.pullbackDepthPercent ?? "",
          priceBehaviour.pullbackBars,
          priceBehaviour.recoverySpeedRatio ?? "",
          priceBehaviour.breakState,
          priceBehaviour.breakLevel ?? "",
          priceBehaviour.breakLookback,
          priceBehaviour.momentumCondition,
          priceBehaviour.accelerationRatio ?? "",
          priceBehaviour.extensionVsAverageRange20 ?? "",
          priceBehaviour.freshnessScore,
          priceBehaviour.lateEntryRisk,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    yield `${rows.join("\n")}\n`;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid export request." }, { status: 400 });
  }

  const analysis = analysisCache.get(parsed.data.analysisId);
  if (!analysis) {
    return Response.json(
      { error: "Analysis expired or was not found. Run the analysis again." },
      { status: 410 },
    );
  }

  const timeframe = parsed.data.timeframe as Timeframe;
  const dataset = analysis.datasets[timeframe];
  const filename = `XAUUSD-${timeframe}-${analysis.meta.requestedFromUtc.slice(0, 10)}`;

  if (parsed.data.format === "json") {
    return new Response(
      streamGenerator(
        createJsonChunks({
          analysisId: analysis.id,
          meta: analysis.meta,
          quality: analysis.quality,
          timeframe,
          behaviourSummary: analysis.behaviourSummaries[timeframe],
          priceBehaviourSummary: analysis.priceBehaviourSummaries[timeframe],
          marketStateSummary: analysis.marketStateSummary,
          latestMarketState: analysis.latestMarketState,
          hypothesisOpportunitySummary: analysis.hypothesisOpportunitySummary,
          latestHypothesisOpportunity: analysis.latestHypothesisOpportunity,
          signalDecisionSummary: analysis.signalDecisionSummary,
          latestSignalDecision: analysis.latestSignalDecision,
          tradeManagementSummary: analysis.tradeManagementSummary,
          latestTradePlan: analysis.latestTradePlan,
          candles: dataset.candles,
          completeness: dataset.completeness,
        }),
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.json"`,
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return new Response(streamGenerator(createCsvChunks(dataset.candles, dataset.completeness)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
