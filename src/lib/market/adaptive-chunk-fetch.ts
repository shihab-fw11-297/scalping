import {
  countFinageChunkCalendarDays,
  splitFinageDateChunk,
  type FinageDateChunk,
} from "./chunk-plan";

export interface AdaptiveChunkEnvelope<TRecord> {
  results: TRecord[];
  totalResults?: number;
}

export interface AdaptiveFetchedChunk<TRecord> {
  chunk: FinageDateChunk;
  results: TRecord[];
  providerTotalResults?: number;
}

export interface AdaptiveChunkFetchResult<TRecord> {
  leaves: AdaptiveFetchedChunk<TRecord>[];
  splitCount: number;
}

export interface FetchDateChunkAdaptiveParams<TRecord> {
  chunk: FinageDateChunk;
  minimumCalendarDays: number;
  maximumSplitDepth: number;
  fetchChunk: (
    chunk: FinageDateChunk,
  ) => Promise<AdaptiveChunkEnvelope<TRecord>>;
}

function canSplitChunk(
  chunk: FinageDateChunk,
  depth: number,
  minimumCalendarDays: number,
  maximumSplitDepth: number,
): boolean {
  return (
    depth < maximumSplitDepth &&
    countFinageChunkCalendarDays(chunk) > minimumCalendarDays &&
    splitFinageDateChunk(chunk) !== null
  );
}

function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

function shouldSplitAfterError(error: unknown): boolean {
  const status = readErrorStatus(error);
  if (status !== undefined) return status >= 500 && status <= 599;
  if (error instanceof TypeError) return true;
  return error instanceof Error && error.name === "AbortError";
}

function createTruncationError(
  chunk: FinageDateChunk,
  received: number,
  total: number,
): Error & { status: number } {
  const error = new Error(
    `Provider chunk ${chunk.fromDate}..${chunk.toDate} was truncated: ` +
      `${received}/${total} records received.`,
  ) as Error & { status: number };
  error.status = 502;
  return error;
}

/**
 * Generic adaptive date-chunk fetcher.
 *
 * A successful complete response becomes one leaf. A persistent 5xx, network
 * timeout, or truncated response is divided into two smaller inclusive date
 * ranges. Child ranges are fetched sequentially to avoid an API request burst.
 * HTTP 429 and permanent 4xx responses are never split into extra calls.
 */
export async function fetchDateChunkAdaptive<TRecord>(
  params: FetchDateChunkAdaptiveParams<TRecord>,
): Promise<AdaptiveChunkFetchResult<TRecord>> {
  const {
    chunk,
    minimumCalendarDays,
    maximumSplitDepth,
    fetchChunk,
  } = params;

  async function fetchNode(
    currentChunk: FinageDateChunk,
    depth: number,
  ): Promise<AdaptiveChunkFetchResult<TRecord>> {
    try {
      const response = await fetchChunk(currentChunk);
      const truncated =
        response.totalResults !== undefined &&
        response.totalResults > response.results.length;

      if (!truncated) {
        return {
          leaves: [
            {
              chunk: currentChunk,
              results: response.results,
              providerTotalResults: response.totalResults,
            },
          ],
          splitCount: 0,
        };
      }

      if (
        !canSplitChunk(
          currentChunk,
          depth,
          minimumCalendarDays,
          maximumSplitDepth,
        )
      ) {
        throw createTruncationError(
          currentChunk,
          response.results.length,
          response.totalResults!,
        );
      }
    } catch (error) {
      if (
        !shouldSplitAfterError(error) ||
        !canSplitChunk(
          currentChunk,
          depth,
          minimumCalendarDays,
          maximumSplitDepth,
        )
      ) {
        throw error;
      }
    }

    const children = splitFinageDateChunk(currentChunk);
    if (!children) {
      throw createTruncationError(currentChunk, 0, 1);
    }

    const left = await fetchNode(children[0], depth + 1);
    const right = await fetchNode(children[1], depth + 1);
    return {
      leaves: [...left.leaves, ...right.leaves],
      splitCount: 1 + left.splitCount + right.splitCount,
    };
  }

  return fetchNode(chunk, 0);
}
