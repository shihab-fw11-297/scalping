/**
 * Order-preserving bounded-concurrency mapper.
 * Results remain in input order, so date chunks can be concatenated without a
 * global sort when each provider response is ascending.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (concurrency < 1) throw new Error("Concurrency must be at least 1.");

  const results = new Array<TOutput>(values.length);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    () => consume(),
  );
  await Promise.all(workers);
  return results;
}
