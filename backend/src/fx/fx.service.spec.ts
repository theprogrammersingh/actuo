import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FxRateRecord, FxRateRepository } from '../supabase/repositories.js';
import { FxService } from './fx.service.js';

const TODAY = new Date().toISOString().slice(0, 10);

/** A Frankfurter response body. `date` is the day the ECB actually published. */
function body(rate: number, date: string) {
  return { amount: 1, base: 'USD', date, rates: { INR: rate } };
}

function ok(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

function createService(options: {
  cached?: FxRateRecord | null;
  onFind?: () => never;
  onSave?: () => never;
} = {}) {
  const saved: Array<Omit<FxRateRecord, 'fetchedAt'>> = [];

  const rates: FxRateRepository = {
    find: async () => {
      options.onFind?.();
      return options.cached ?? null;
    },
    save: async (record) => {
      options.onSave?.();
      saved.push(record);
    },
  };

  return { service: new FxService(rates), saved };
}

function cached(overrides: Partial<FxRateRecord> = {}): FxRateRecord {
  return {
    base: 'USD',
    quote: 'INR',
    asOfDate: '2026-08-14',
    rateDate: '2026-08-14',
    rate: 95.43,
    source: 'frankfurter/ecb',
    fetchedAt: '2026-08-14T17:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rateOn', () => {
  it('answers an identity pair without asking anyone', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService();

    // Not just an optimisation: Frankfurter rejects base === symbol, so a
    // round trip here would fail and leave a base-currency expense unconverted.
    await expect(service.rateOn('INR', 'INR', '2026-08-14')).resolves.toEqual({
      rate: 1,
      rateDate: '2026-08-14',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a cached rate without a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService({ cached: cached() });

    await expect(service.rateOn('USD', 'INR', '2026-08-14')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches on a miss, and writes what it got back to the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14')));
    vi.stubGlobal('fetch', fetchMock);
    const { service, saved } = createService();

    await expect(service.rateOn('usd', 'inr', '2026-08-14')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });

    // Currencies are upper-cased before they reach the URL or the cache key,
    // or the same pair would be cached twice under different spellings.
    expect(String(fetchMock.mock.calls[0][0])).toContain('/2026-08-14?base=USD&symbols=INR');
    expect(saved).toEqual([
      {
        base: 'USD',
        quote: 'INR',
        asOfDate: '2026-08-14',
        rateDate: '2026-08-14',
        rate: 95.43,
        source: 'frankfurter/ecb',
      },
    ]);
  });

  it('records the day the rate is really from when a weekend resolves backwards', async () => {
    // 2026-08-16 is a Sunday. The ECB published on the Friday.
    const fetchMock = vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14')));
    vi.stubGlobal('fetch', fetchMock);
    const { service, saved } = createService();

    await expect(service.rateOn('USD', 'INR', '2026-08-16')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });
    // Keyed by the day asked for, so the next Sunday lookup hits the cache;
    // stamped with the day published, so the figure can be defended.
    expect(saved[0]).toMatchObject({ asOfDate: '2026-08-16', rateDate: '2026-08-14' });
  });

  it('reuses a past weekend entry rather than re-fetching it forever', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService({
      cached: cached({ asOfDate: '2026-08-16', rateDate: '2026-08-14' }),
    });

    // Resolved backwards, but the day asked for is in the past — Saturday's
    // rate is never going to be published, so this entry is final.
    await expect(service.rateOn('USD', 'INR', '2026-08-16')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches today's rate while it is still standing in for an earlier day", async () => {
    // Written before the ECB's ~16:00 CET publication, so it holds yesterday's
    // rate under today's key. Treating that as final would pin it there.
    const fetchMock = vi.fn().mockResolvedValue(ok(body(94.97, TODAY)));
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService({
      cached: cached({ asOfDate: TODAY, rateDate: '2026-01-01', rate: 1 }),
    });

    await expect(service.rateOn('USD', 'INR', TODAY)).resolves.toEqual({
      rate: 94.97,
      rateDate: TODAY,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps today's rate once it has settled on today", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService({
      cached: cached({ asOfDate: TODAY, rateDate: TODAY, rate: 94.97 }),
    });

    await expect(service.rateOn('USD', 'INR', TODAY)).resolves.toEqual({
      rate: 94.97,
      rateDate: TODAY,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the publisher is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const { service } = createService();

    // The whole contract: a missing rate must never fail the expense save.
    await expect(service.rateOn('USD', 'INR', '2026-08-14')).resolves.toBeNull();
  });

  it('returns null on an HTTP error, such as a currency the ECB does not publish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response));
    const { service } = createService();

    await expect(service.rateOn('USD', 'XYZ', '2026-08-14')).resolves.toBeNull();
  });

  it.each([
    ['a missing rate', { amount: 1, date: '2026-08-14', rates: {} }],
    ['a zero rate', body(0, '2026-08-14')],
    ['a rate that is not a number', { date: '2026-08-14', rates: { INR: 'lots' } }],
    ['no date', { rates: { INR: 95.43 } }],
    ['a date that is not one', { date: 'yesterday', rates: { INR: 95.43 } }],
  ])('returns null on an unusable body: %s', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(payload)));
    const { service, saved } = createService();

    // A zero here would be the dangerous case: it would write a converted
    // amount of 0.00 that reads as a real figure everywhere downstream.
    await expect(service.rateOn('USD', 'INR', '2026-08-14')).resolves.toBeNull();
    expect(saved).toEqual([]);
  });

  it('still returns the rate when the cache cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14'))));
    const { service } = createService({
      onFind: () => {
        throw new Error('supabase unavailable');
      },
    });

    await expect(service.rateOn('USD', 'INR', '2026-08-14')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });
  });

  it('still returns the rate when the cache cannot be written', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14'))));
    const { service } = createService({
      onSave: () => {
        throw new Error('supabase unavailable');
      },
    });

    await expect(service.rateOn('USD', 'INR', '2026-08-14')).resolves.toEqual({
      rate: 95.43,
      rateDate: '2026-08-14',
    });
  });

  it('trims a timestamp to the date the column and the URL both want', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14')));
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService();

    await service.rateOn('USD', 'INR', '2026-08-14T09:30:00.000Z');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/2026-08-14?');
  });

  it('returns null for a date it cannot make sense of', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = createService();

    // Never concatenated into the URL unchecked.
    await expect(service.rateOn('USD', 'INR', 'last Tuesday')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('lock', () => {
  it('converts and rounds to the two decimals the column stores', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(body(95.43, '2026-08-14'))));
    const { service } = createService();

    // 20 * 95.43 = 1908.6 exactly; 12.34 * 95.43 = 1177.6062 rounds.
    await expect(service.lock(20, 'USD', 'INR', '2026-08-14')).resolves.toEqual({
      convertedAmount: 1908.6,
      rate: 95.43,
      rateDate: '2026-08-14',
    });
    await expect(service.lock(12.34, 'USD', 'INR', '2026-08-14')).resolves.toEqual({
      convertedAmount: 1177.61,
      rate: 95.43,
      rateDate: '2026-08-14',
    });
  });

  it('is exact for a base-currency amount', async () => {
    const { service } = createService();

    await expect(service.lock(6450, 'INR', 'INR', '2026-08-14')).resolves.toEqual({
      convertedAmount: 6450,
      rate: 1,
      rateDate: '2026-08-14',
    });
  });

  it('is null when no rate could be locked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { service } = createService();

    await expect(service.lock(20, 'USD', 'INR', '2026-08-14')).resolves.toBeNull();
  });
});
