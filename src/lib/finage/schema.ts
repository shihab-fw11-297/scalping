import { z } from "zod";

/**
 * Finage normally returns numeric OHLCV fields, but some plans/proxies have
 * returned numeric strings. Coercion keeps the client compatible without
 * weakening the normalized market types.
 */
const finiteNumber = z.coerce.number().refine(Number.isFinite, {
  message: "Expected a finite number.",
});

export const finageAggregateSchema = z.object({
  o: finiteNumber,
  h: finiteNumber,
  l: finiteNumber,
  c: finiteNumber,
  v: finiteNumber.optional(),
  t: z.union([z.number(), z.string()]),
});

export const finageAggregateResponseSchema = z.object({
  symbol: z.string(),
  totalResults: z.coerce.number().int().nonnegative().optional(),
  results: z.array(finageAggregateSchema),
});

export const finageErrorResponseSchema = z
  .object({
    error: z.unknown().optional(),
    message: z.unknown().optional(),
    status: z.unknown().optional(),
    code: z.unknown().optional(),
  })
  .passthrough();

export type FinageAggregateResponse = z.infer<
  typeof finageAggregateResponseSchema
>;
