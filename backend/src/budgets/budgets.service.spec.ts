import { describe, expect, it } from 'vitest';
import type { EnvService } from '../config/env.service.js';
import type {
  BudgetRepository,
  CategorySpendRow,
  ExpenseRepository,
  OrgRepository,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { BudgetsService } from './budgets.service.js';

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};

const TRAVEL = 'cat-travel';
const DINING = 'cat-dining';

function createService(options: {
  spend?: CategorySpendRow[];
  budgets?: Array<{ categoryId: string | null; amount: number }>;
}) {
  const budgets = {
    list: async () =>
      (options.budgets ?? []).map((b, i) => ({
        id: `budget-${i}`,
        orgId: USER.orgId,
        categoryId: b.categoryId,
        amount: b.amount,
        period: 'monthly' as const,
        rollover: false,
        createdAt: '2026-08-01T00:00:00.000Z',
      })),
  } as unknown as BudgetRepository;

  const expenses = {
    sumByCategory: async () => options.spend ?? [],
  } as unknown as ExpenseRepository;

  const orgs = {
    listCategories: async () => [
      { id: TRAVEL, orgId: USER.orgId, name: 'Travel', icon: null, isDefault: true },
      { id: DINING, orgId: USER.orgId, name: 'Dining', icon: null, isDefault: true },
    ],
    findOrg: async () => ({ id: USER.orgId, name: 'Acme', baseCurrency: 'INR' }),
  } as unknown as OrgRepository;

  const env = { baseCurrency: 'INR' } as unknown as EnvService;

  return new BudgetsService(env, budgets, expenses, orgs);
}

describe('BudgetsService.status', () => {
  it('reports how many expenses were left out of spend for want of a converted amount', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000 }],
      spend: [{ categoryId: TRAVEL, total: 2_500, unconverted: 3 }],
    });

    const [travel] = await service.status(USER, {});

    // The three foreign-currency rows are counted, never added: the old code
    // summed their raw amounts, so a $200 charge landed in an INR budget as 200.
    expect(travel.spent).toBe(2_500);
    expect(travel.unconvertedCount).toBe(3);
  });

  it('reports zero unconverted when every row is in the base currency', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000 }],
      spend: [{ categoryId: TRAVEL, total: 2_500, unconverted: 0 }],
    });

    const [travel] = await service.status(USER, {});
    expect(travel.unconvertedCount).toBe(0);
  });

  it('surfaces a category whose only spend is unconverted, rather than hiding it', async () => {
    /*
     * `spent: 0` with `unconvertedCount: 4` is the honest shape: nothing can be
     * totalled, and there is something there. Dropping the row would tell the
     * user the category is untouched.
     */
    const service = createService({
      budgets: [],
      spend: [{ categoryId: DINING, total: 0, unconverted: 4 }],
    });

    const rows = await service.status(USER, {});
    const dining = rows.find((row) => row.categoryId === DINING);

    expect(dining).toBeDefined();
    expect(dining!.spent).toBe(0);
    expect(dining!.unconvertedCount).toBe(4);
  });

  it('defaults a budgeted category with no spend row to zero on both counts', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000 }],
      spend: [],
    });

    const [travel] = await service.status(USER, {});
    expect(travel.spent).toBe(0);
    expect(travel.unconvertedCount).toBe(0);
  });
});
