import type { Page } from './dto.js';

/**
 * Safety valve. `total` comes from the server; if it is ever wrong or a page
 * comes back empty, the loop must still end rather than spin.
 */
const MAX_PAGES = 200;

/**
 * Collect every row of a paginated endpoint.
 *
 * Exists because the page cap cannot simply be raised for callers that need a
 * complete set. A report that quietly omits expenses, or a dashboard total that
 * silently understates spend, is worse than an error — it is a confident wrong
 * answer, which in a finance tool is the failure that matters.
 *
 * `fetchPage` is given an offset and returns one page. The loop stops when it
 * has `total` rows, when a page comes back short, or at `MAX_PAGES`.
 *
 * `onPage` runs after each page, and may throw to abort — that is how report
 * generation stays cancellable while fetching, not just while formatting.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  options: { limit: number; onPage?: (collected: readonly T[], total: number) => void },
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const { limit, onPage } = options;
  const items: T[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(items.length, limit);
    total = result.total;
    items.push(...result.items);

    onPage?.(items, total);

    // A short page means the server has no more, whatever `total` claims.
    if (result.items.length === 0 || result.items.length < limit) break;
    if (items.length >= total) break;
  }

  return { items, total, truncated: items.length < total };
}
