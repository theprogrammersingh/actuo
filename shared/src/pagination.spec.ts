import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './pagination.js';

function pager(total: number, limit: number) {
  return vi.fn(async (offset: number, size: number) => ({
    items: Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) => offset + i),
    total,
    limit: size,
    offset,
  }));
}

describe('fetchAllPages', () => {
  it('assembles every page in order', async () => {
    const fetchPage = pager(250, 100);
    const result = await fetchAllPages<number>(fetchPage, { limit: 100 });

    expect(result.items).toHaveLength(250);
    expect(result.items[0]).toBe(0);
    expect(result.items[249]).toBe(249);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    // Offsets must advance, or the loop re-reads page one forever.
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 100, 200]);
  });

  it('makes a single request when everything fits on one page', async () => {
    const fetchPage = pager(40, 100);
    const result = await fetchAllPages<number>(fetchPage, { limit: 100 });

    expect(result.items).toHaveLength(40);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('handles an empty result', async () => {
    const fetchPage = pager(0, 100);
    const result = await fetchAllPages<number>(fetchPage, { limit: 100 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('exactly fills the last page without an extra request', async () => {
    const fetchPage = pager(200, 100);
    const result = await fetchAllPages<number>(fetchPage, { limit: 100 });

    expect(result.items).toHaveLength(200);
    // 200/100 needs two requests; a third would be a wasted round trip.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  /**
   * The safety valve. If `total` is wrong the loop must still end — an
   * unbounded fetch loop in a request handler is far worse than a short read.
   */
  it('terminates when total lies about how many rows exist', async () => {
    const fetchPage = vi.fn(async (offset: number, size: number) => ({
      items: offset === 0 ? Array.from({ length: size }, (_, i) => i) : [],
      total: 10_000,
      limit: size,
      offset,
    }));

    const result = await fetchAllPages<number>(fetchPage, { limit: 100 });

    expect(result.items).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('reports progress after each page', async () => {
    const seen: number[] = [];
    await fetchAllPages<number>(pager(250, 100), {
      limit: 100,
      onPage: (collected) => seen.push(collected.length),
    });
    expect(seen).toEqual([100, 200, 250]);
  });

  it('lets onPage abort the fetch by throwing', async () => {
    const fetchPage = pager(1000, 100);
    await expect(
      fetchAllPages<number>(fetchPage, {
        limit: 100,
        onPage: (collected) => {
          if (collected.length >= 200) throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');

    // Stopped early rather than draining all ten pages.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
