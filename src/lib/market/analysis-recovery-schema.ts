import { z } from "zod";

export const ANALYSIS_RECOVERY_QUERY_SHAPE = {
  recoveryFromUtc: z.iso.datetime().optional(),
  recoveryToUtc: z.iso.datetime().optional(),
  recoverySpread: z.coerce.number().min(0).max(20).optional(),
  recoverySlippage: z.coerce.number().min(0).max(20).optional(),
  recoveryMinimumRiskReward: z.coerce.number().min(1).max(10).optional(),
  recoveryMaximumRiskRanges: z.coerce.number().min(0.5).max(10).optional(),
};
