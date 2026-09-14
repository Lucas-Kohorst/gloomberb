/**
 * Bounded-parallel map. Results keep input order, and no more than `concurrency`
 * workers run at once, so a wide fan-out (one request per portfolio ticker, say)
 * cannot open every request in the same tick and stall the render loop.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}
