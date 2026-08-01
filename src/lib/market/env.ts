import { z } from "zod";

const envSchema = z.object({
  FINAGE_API_KEY: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value: string) => !value.startsWith("http") && !value.includes("apikey="),
      "Set only the Finage API key value, not the complete URL or apikey= query.",
    ),
  FINAGE_REST_BASE_URL: z.url().default("https://api.finage.co.uk"),
  FINAGE_XAUUSD_SYMBOL: z.string().min(1).default("XAUUSD"),
  FINAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  FINAGE_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  FINAGE_SORT: z.enum(["provider_default", "asc", "desc"]).default("provider_default"),
  FINAGE_DATE_FORMAT: z.enum(["provider_default", "ts", "dt"]).default("provider_default"),
  FINAGE_MAX_RESULTS_PER_REQUEST: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(50_000)
    .default(50_000),
  APP_MAX_CANDLES: z.coerce.number().int().min(1_000).max(250_000).default(100_000),
  APP_MAX_WINDOW_CANDLES: z.coerce.number().int().min(500).max(10_000).default(5_000),
  ANALYSIS_CACHE_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  ANALYSIS_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(10).default(3),
  ANALYSIS_CACHE_MAX_TOTAL_CANDLES: z.coerce.number().int().min(10_000).max(1_000_000).default(200_000),
  FOREX_WEEKEND_MODE: z.enum(["NEW_YORK_17", "FIXED_UTC"]).default("NEW_YORK_17"),
  FOREX_FRIDAY_CLOSE_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(22),
  FOREX_SUNDAY_OPEN_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(22),
  DAILY_BOUNDARY_MODE: z.enum(["UTC_MIDNIGHT", "NEW_YORK_17"]).default("NEW_YORK_17"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getServerEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${parsed.error.issues
        .map((issue: { path: PropertyKey[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
