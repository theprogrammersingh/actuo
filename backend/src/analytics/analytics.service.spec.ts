import { describe, expect, it } from 'vitest';
import type { EnvService } from '../config/env.service.js';
import type {
  CategorySpendRow,
  ExpenseRepository,
  OrgRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AnalyticsService } from './analytics.service.js';

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};

const TRAVEL = 'cat-travel';
const DINING = 'cat-dining';

function createService(options: {
  currentSpend?: CategorySpendRow[];
  previousSpend?: CategorySpendRow[];
}) {
  let callCount = 0;

  const expenses = {
    sumByCategory: async () => {
      callCount += 1;
      // First call is for current window, second is for previous.
      return callCount === 1
        ? (options.currentSpend ?? [])
        : (options.previousSpend ?? []);
    },
  } as unknown as ExpenseRepository;

  const orgs = {
    listCategories: async () => [
      { id: TRAVEL, orgId: USER.orgId, name: 'Travel', icon: null, isDefault: true },
      { id: DINING, orgId: USER.orgId, name: 'Dining', icon: null, isDefault: true },
    ],
    findOrg: async () => ({ id: USER.orgId, name: 'Acme', baseCurrency: 'INR' }),
  } as unknown as OrgRepository;

  const env = { baseCurrency: 'INR' } as unknown as EnvService;

  return new AnalyticsService(env, expenses, orgs);
}

describe('AnalyticsService.summary', () => {
  it('returns the correct shape with month and currency', async () => {
    const service = createService({
      currentSpend: [{ categoryId: TRAVEL, total: 5_000, unconverted: 0 }],
      previousSpend: [{ categoryId: TRAVEL, total: 4_000, unconverted: 0 }],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    expect(result.month).toBe('2026-09');
    expect(result.currency).toBe('INR');
    expect(result.monthSpend).toBe(5_000);
    expect(result.previousMonthSpend).toBe(4_000);
    expect(result.draftCount).toBe(0);
  });

  it('computes month-over-month delta as percentage change', async () => {
    const service = createService({
      currentSpend: [{ categoryId: TRAVEL, total: 6_000, unconverted: 0 }],
      previousSpend: [{ categoryId: TRAVEL, total: 4_000, unconverted: 0 }],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    // (6000 / 4000 - 1) * 100 = 50
    expect(result.monthOverMonthDelta).toBe(50);
  });

  it('returns null MoM delta when previous spend is zero', async () => {
    const service = createService({
      currentSpend: [{ categoryId: TRAVEL, total: 5_000, unconverted: 0 }],
      previousSpend: [],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    expect(result.monthOverMonthDelta).toBeNull();
  });

  it('computes category shares that sum to approximately 1', async () => {
    const service = createService({
      currentSpend: [
        { categoryId: TRAVEL, total: 3_000, unconverted: 0 },
        { categoryId: DINING, total: 2_000, unconverted: 0 },
      ],
      previousSpend: [],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    const totalShare = result.byCategory.reduce((sum, c) => sum + c.share, 0);
    expect(totalShare).toBeCloseTo(1, 1);
    expect(result.byCategory[0].categoryId).toBe(TRAVEL); // sorted by spent desc
    expect(result.byCategory[0].share).toBe(0.6);
    expect(result.byCategory[1].share).toBe(0.4);
  });

  it('reports unconverted count from the current window', async () => {
    const service = createService({
      currentSpend: [
        { categoryId: TRAVEL, total: 2_000, unconverted: 3 },
        { categoryId: DINING, total: 1_000, unconverted: 1 },
      ],
      previousSpend: [],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    expect(result.unconvertedCount).toBe(4);
  });

  it('labels uncategorised spend correctly', async () => {
    const service = createService({
      currentSpend: [{ categoryId: null, total: 1_000, unconverted: 0 }],
      previousSpend: [],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    expect(result.byCategory[0].categoryName).toBe('Uncategorised');
  });

  it('handles zero spend gracefully with zero shares', async () => {
    const service = createService({
      currentSpend: [],
      previousSpend: [],
    });

    const result = await service.summary(USER, { from: '2026-09-01', to: '2026-09-30' });

    expect(result.monthSpend).toBe(0);
    expect(result.byCategory).toEqual([]);
  });
});
