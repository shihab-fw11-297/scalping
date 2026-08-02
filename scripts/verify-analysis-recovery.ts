import {
  recoveryRequestFromQuery,
  resolveAnalysis,
  type AnalysisRecoveryQuery,
} from "../src/lib/market/analysis-recovery";
import type { CachedAnalysis } from "../src/lib/market/types";

function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main(): Promise<void> {
  const query: AnalysisRecoveryQuery = {
    analysisId: "00000000-0000-4000-8000-000000000099",
    recoveryFromUtc: "2026-07-25T00:00:00.000Z",
    recoveryToUtc: "2026-08-01T00:00:00.000Z",
    recoverySpread: 0.25,
    recoverySlippage: 0.1,
    recoveryMinimumRiskReward: 1.5,
    recoveryMaximumRiskRanges: 3.5,
  };

  const request = recoveryRequestFromQuery(query);
  assertCondition(request !== null, "Recovery request should be reconstructed.");
  assertCondition(request.assumedSpreadPrice === 0.25, "Spread recovery mismatch.");
  assertCondition(request.minimumRiskReward === 1.5, "R:R recovery mismatch.");

  let rebuildCalls = 0;
  const syntheticAnalysis = {
    id: "00000000-0000-4000-8000-000000000100",
  } as CachedAnalysis;
  const resolved = await resolveAnalysis(query, async (received) => {
    rebuildCalls += 1;
    assertCondition(received.fromUtc === query.recoveryFromUtc, "Recovery date mismatch.");
    return syntheticAnalysis;
  });

  assertCondition(resolved?.recovered === true, "Cache miss should be marked recovered.");
  assertCondition(resolved.analysis === syntheticAnalysis, "Rebuilt analysis was not returned.");
  assertCondition(rebuildCalls === 1, "Rebuilder should run exactly once.");

  const missing = await resolveAnalysis(
    { analysisId: "00000000-0000-4000-8000-000000000101" },
    async () => {
      throw new Error("Rebuilder must not run without recovery parameters.");
    },
  );
  assertCondition(missing === null, "Missing recovery parameters should return null.");

  console.log(JSON.stringify({ ok: true, rebuildCalls, missingRecoveryReturnsNull: true }, null, 2));
}

void main();
