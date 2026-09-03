import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '@actuo/shared';
import type { EnvService } from '../config/env.service.js';
import type { FxService, LockedConversion } from '../fx/fx.service.js';
import type {
  AuditLogRepository,
  CreateExpenseInput,
  ExpenseRepository,
  OrgRepository,
  UpdateExpenseInput,
} from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ExpensesService } from './expenses.service.js';

/**
 * What this file is about: the three conversion fields on an expense, and the
 * rule that they always move together (PRD §6.5). The state machine has its own
 * spec; RBAC is covered end to end in `test/rbac.e2e-spec.ts`.
 */

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};

const EXPENSE_ID = 'exp-1';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: EXPENSE_ID,
    orgId: USER.orgId,
    userId: USER.userId,
    categoryId: null,
    amount: 20,
    currency: 'USD',
    convertedAmount: 1908.6,
    fxRate: 95.43,
    fxRateDate: '2026-08-14',
    baseCurrency: 'INR',
    merchant: 'Figma',
    note: null,
    status: 'draft',
    receiptUrl: null,
    expenseDate: '2026-08-14',
    createdAt: '2026-08-14T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function createService(options: { lock?: LockedConversion | null; existing?: Expense } = {}) {
  const created: CreateExpenseInput[] = [];
  const patched: UpdateExpenseInput[] = [];

  const lock = vi.fn(async () => options.lock ?? null);
  const fx = { lock } as unknown as FxService;

  const expenses = {
    findById: async () => options.existing ?? expense(),
    create: async (input: CreateExpenseInput) => {
      created.push(input);
      return expense(input as Partial<Expense>);
    },
    update: async (_orgId: string, _id: string, patch: UpdateExpenseInput) => {
      patched.push(patch);
      return expense(patch as Partial<Expense>);
    },
  } as unknown as ExpenseRepository;

  const orgs = {
    findOrg: async () => ({ id: USER.orgId, name: 'Northwind', baseCurrency: 'INR' }),
  } as unknown as OrgRepository;

  const audit = { append: async () => undefined } as unknown as AuditLogRepository;
  const env = { baseCurrency: 'INR' } as unknown as EnvService;

  return {
    service: new ExpensesService(env, fx, expenses, orgs, audit),
    created,
    patched,
    lock,
  };
}

const LOCKED: LockedConversion = { convertedAmount: 1908.6, rate: 95.43, rateDate: '2026-08-14' };

describe('create', () => {
  it('locks the rate at the expense’s own date, not today', async () => {
    const { service, created, lock } = createService({ lock: LOCKED });

    await service.create(USER, {
      amount: 20,
      currency: 'USD',
      expenseDate: '2026-08-14',
    } as never);

    // The date argument is the whole point of a historical lock: a rate looked
    // up today would make last month's spend drift every time it is read.
    expect(lock).toHaveBeenCalledWith(20, 'USD', 'INR', '2026-08-14');
    expect(created[0]).toMatchObject({
      convertedAmount: 1908.6,
      fxRate: 95.43,
      fxRateDate: '2026-08-14',
    });
  });

  it('writes three nulls when no rate could be locked, and still saves the expense', async () => {
    const { service, created } = createService({ lock: null });

    // A currency API being down must not stop someone filing an expense. The
    // row is saved, excluded from totals, and counted — the state sumSpend()
    // and sumByCategory() already report honestly.
    const saved = await service.create(USER, {
      amount: 20,
      currency: 'USD',
      expenseDate: '2026-08-14',
    } as never);

    expect(saved).toBeDefined();
    expect(created[0]).toMatchObject({
      convertedAmount: null,
      fxRate: null,
      fxRateDate: null,
    });
  });
});

describe('update', () => {
  it('re-locks when the currency changes', async () => {
    const { service, patched, lock } = createService({ lock: LOCKED, existing: expense() });

    await service.update(USER, EXPENSE_ID, { currency: 'EUR' } as never);

    expect(lock).toHaveBeenCalledWith(20, 'EUR', 'INR', '2026-08-14');
    expect(patched[0]).toMatchObject({ fxRate: 95.43, fxRateDate: '2026-08-14' });
  });

  it('re-locks when the amount changes', async () => {
    const { service, lock } = createService({ lock: LOCKED, existing: expense() });

    await service.update(USER, EXPENSE_ID, { amount: 50 } as never);

    expect(lock).toHaveBeenCalledWith(50, 'USD', 'INR', '2026-08-14');
  });

  it('re-locks when only the DATE changes', async () => {
    const { service, lock } = createService({ lock: LOCKED, existing: expense() });

    // The easy one to miss. The lock is the rate on the expense's own day, so
    // moving the day leaves a stored rate describing a conversion that never
    // happened.
    await service.update(USER, EXPENSE_ID, { expenseDate: '2026-07-01' } as never);

    expect(lock).toHaveBeenCalledWith(20, 'USD', 'INR', '2026-07-01');
  });

  it('leaves the conversion alone when the edit cannot have changed it', async () => {
    const { service, patched, lock } = createService({ lock: LOCKED, existing: expense() });

    await service.update(USER, EXPENSE_ID, { merchant: 'Figma Inc' } as never);

    expect(lock).not.toHaveBeenCalled();
    expect(patched[0]).not.toHaveProperty('fxRate');
    expect(patched[0]).not.toHaveProperty('convertedAmount');
  });

  it('clears all three when a re-lock fails, rather than leaving the old rate', async () => {
    const { service, patched } = createService({ lock: null, existing: expense() });

    await service.update(USER, EXPENSE_ID, { currency: 'EUR' } as never);

    // A leftover USD rate on a EUR expense is a wrong number that looks
    // authoritative. Null is excluded and counted, which is visibly incomplete.
    expect(patched[0]).toMatchObject({
      convertedAmount: null,
      fxRate: null,
      fxRateDate: null,
    });
  });
});
