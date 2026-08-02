import { analysisCache } from "./analysis-cache";
import type { AnalysisRecoveryRequest, CachedAnalysis } from "./types";

export interface AnalysisRecoveryQuery {
  analysisId: string;
  recoveryFromUtc?: string;
  recoveryToUtc?: string;
  recoverySpread?: number;
  recoverySlippage?: number;
  recoveryMinimumRiskReward?: number;
  recoveryMaximumRiskRanges?: number;
}

export interface ResolvedAnalysis {
  analysis: CachedAnalysis;
  recovered: boolean;
}

export type AnalysisRebuilder = (
  request: AnalysisRecoveryRequest,
) => Promise<CachedAnalysis>;

export function recoveryRequestFromQuery(
  query: AnalysisRecoveryQuery,
): AnalysisRecoveryRequest | null {
  if (!query.recoveryFromUtc || !query.recoveryToUtc) return null;
  if (
    query.recoverySpread === undefined ||
    query.recoverySlippage === undefined ||
    query.recoveryMinimumRiskReward === undefined ||
    query.recoveryMaximumRiskRanges === undefined
  ) {
    return null;
  }

  return {
    fromUtc: query.recoveryFromUtc,
    toUtc: query.recoveryToUtc,
    assumedSpreadPrice: query.recoverySpread,
    assumedSlippagePrice: query.recoverySlippage,
    minimumRiskReward: query.recoveryMinimumRiskReward,
    maximumRiskInAverageRanges: query.recoveryMaximumRiskRanges,
  };
}

async function rebuildAnalysisFromFinage(
  recoveryRequest: AnalysisRecoveryRequest,
): Promise<CachedAnalysis> {
  const { analyzeHistoricalMarket } = await import("./pipeline");
  const rebuilt = await analyzeHistoricalMarket(recoveryRequest);
  const analysis = analysisCache.get(rebuilt.analysisId);
  if (!analysis) {
    throw new Error("Analysis was rebuilt, but the server could not read the rebuilt dataset.");
  }
  return analysis;
}

export async function resolveAnalysis(
  query: AnalysisRecoveryQuery,
  rebuildAnalysis: AnalysisRebuilder = rebuildAnalysisFromFinage,
): Promise<ResolvedAnalysis | null> {
  const cached = analysisCache.get(query.analysisId);
  if (cached) return { analysis: cached, recovered: false };

  const recoveryRequest = recoveryRequestFromQuery(query);
  if (!recoveryRequest) return null;

  const analysis = await rebuildAnalysis(recoveryRequest);
  return { analysis, recovered: true };
}

