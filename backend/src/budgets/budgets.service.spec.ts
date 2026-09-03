import { NotFoundException } from '@nestjs/common';
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
  prevSpend?: CategorySpendRow[];
  budgets?: Array<{ categoryId: string | null; amount: number; rollover?: boolean }>;
}) {
  const budgets = {
    list: async () =>
      (options.budgets ?? []).map((b, i) => ({
        id: `budget-${i}`,
        orgId: USER.orgId,
        categoryId: b.categoryId,
        amount: b.amount,
        period: 'monthly' as const,
        rollover: b.rollover ?? false,
        createdAt: '2026-08-01T00:00:00.000Z',
      })),
  } as unknown as BudgetRepository;

  // Track which window is being queried to return current vs previous spend
  let callCount = 0;
  const expenses = {
    sumByCategory: async () => {
      callCount++;
      // First call is current window, second is previous (if rollover is enabled)
      return callCount === 1 ? (options.spend ?? []) : (options.prevSpend ?? []);
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

describe('BudgetsService.status — rollover (PRD §6.3)', () => {
  it('carries unspent budget forward when rollover is true', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000, rollover: true }],
      spend: [{ categoryId: TRAVEL, total: 3_000, unconverted: 0 }],
      // Previous month: budget was 10,000, only spent 6,000 → carry 4,000
      prevSpend: [{ categoryId: TRAVEL, total: 6_000, unconverted: 0 }],
    });

    const [travel] = await service.status(USER, {});

    expect(travel.declaredBudget).toBe(10_000);
    expect(travel.carryforward).toBe(4_000);
    expect(travel.budgeted).toBe(14_000); // 10,000 + 4,000 carry
    expect(travel.remaining).toBe(11_000); // 14,000 - 3,000 spent
  });

  it('does not carry forward when rollover is false', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000, rollover: false }],
      spend: [{ categoryId: TRAVEL, total: 3_000, unconverted: 0 }],
      prevSpend: [{ categoryId: TRAVEL, total: 6_000, unconverted: 0 }],
    });

    const [travel] = await service.status(USER, {});

    expect(travel.declaredBudget).toBe(10_000);
    expect(travel.carryforward).toBe(0);
    expect(travel.budgeted).toBe(10_000);
  });

  it('never carries overspend as debt — max(0, unspent)', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000, rollover: true }],
      spend: [{ categoryId: TRAVEL, total: 2_000, unconverted: 0 }],
      // Previous month was over budget: 12,000 spent against 10,000 budget
      prevSpend: [{ categoryId: TRAVEL, total: 12_000, unconverted: 0 }],
    });

    const [travel] = await service.status(USER, {});

    // Overspend does not reduce this month's budget
    expect(travel.carryforward).toBe(0);
    expect(travel.budgeted).toBe(10_000);
  });

  it('carries zero when there is no previous data', async () => {
    const service = createService({
      budgets: [{ categoryId: TRAVEL, amount: 10_000, rollover: true }],
      spend: [{ categoryId: TRAVEL, total: 1_000, unconverted: 0 }],
      prevSpend: [], // No prior spend
    });

    const [travel] = await service.status(USER, {});

    // No prior spend = full budget is unspent, so carry = 10,000
    expect(travel.carryforward).toBe(10_000);
    expect(travel.budgeted).toBe(20_000);
  });
});

describe('BudgetsService.update', () => {
  const BUDGET_ID = 'budget-123';

  function createUpdateService(options: { existingBudget?: object | null }) {
    const budgetData = options.existingBudget ?? {
      id: BUDGET_ID,
      orgId: USER.orgId,
      categoryId: TRAVEL,
      amount: 10_000,
      period: 'monthly' as const,
      rollover: false,
    };

    const budgets = {
      list: async () => [],
      findById: async () => (options.existingBudget === null ? null : budgetData),
      update: async (_orgId: string, _id: string, patch: any) => ({
        ...budgetData,
        ...patch,
      }),
    } as unknown as BudgetRepository;

    const expenses = { sumByCategory: async () => [] } as unknown as ExpenseRepository;
    const orgs = {
      listCategories: async () => [],
      findOrg: async () => ({ id: USER.orgId, name: 'Acme', baseCurrency: 'INR' }),
    } as unknown as OrgRepository;
    const env = { baseCurrency: 'INR' } as unknown as EnvService;

    return new BudgetsService(env, budgets, expenses, orgs);
  }

  it('calls repository and returns updated budget', async () => {
    const service = createUpdateService({});
    const result = await service.update(USER, BUDGET_ID, { amount: 15_000 });
    expect(result.amount).toBe(15_000);
  });

  it('throws NotFoundException when budget does not exist', async () => {
    const service = createUpdateService({ existingBudget: null });
    await expect(service.update(USER, BUDGET_ID, { amount: 15_000 })).rejects.toThrow(
      NotFoundException,
    );
  });
});
