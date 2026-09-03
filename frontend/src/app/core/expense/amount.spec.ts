import type { Expense } from '@actuo/shared';
import { describe, expect, it } from 'vitest';

import {
  excludedNotice,
  expenseAmount,
  expenseCurrency,
  isConverted,
  isSpend,
  sumSpend,
} from './amount.js';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    orgId: 'org-1',
    userId: 'user-1',
    categoryId: 'cat-1',
    amount: 100,
    currency: 'INR',
    convertedAmount: null,
    fxRate: null,
    fxRateDate: null,
    baseCurrency: 'INR',
    merchant: 'Barista',
    note: null,
    status: 'submitted',
    receiptUrl: null,
    expenseDate: '2026-08-10',
    createdAt: '2026-08-10T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('isConverted', () => {
  it('is true when the expense was filed in the base currency', () => {
    expect(isConverted(expense({ currency: 'INR', baseCurrency: 'INR' }))).toBe(true);
  });

  it('is true when FX has written a converted value', () => {
    expect(isConverted(expense({ currency: 'USD', convertedAmount: 8400 }))).toBe(true);
  });

  it('is false for a foreign-currency row with nothing converting it', () => {
    expect(isConverted(expense({ currency: 'USD', convertedAmount: null }))).toBe(false);
  });
});

describe('expenseCurrency', () => {
  it('labels a base-currency row with the base currency', () => {
    expect(expenseCurrency(expense({ currency: 'INR', baseCurrency: 'INR' }))).toBe('INR');
  });

  /**
   * The visible half of the same bug. `baseCurrency || currency` printed an
   * unconverted $50 as ₹50 — not a rounding error, a different number by a
   * factor of about ninety.
   */
  it('labels an unconverted row with the currency it was actually filed in', () => {
    expect(
      expenseCurrency(expense({ amount: 50, currency: 'USD', convertedAmount: null })),
    ).toBe('USD');
  });

  it('labels a converted row with the base currency', () => {
    expect(
      expenseCurrency(expense({ currency: 'USD', convertedAmount: 4200, baseCurrency: 'INR' })),
    ).toBe('INR');
  });
});

describe('sumSpend', () => {
  it('adds rows that are in the base currency', () => {
    const { total, excluded } = sumSpend([
      expense({ id: 'a', amount: 100 }),
      expense({ id: 'b', amount: 250 }),
    ]);

    expect(total).toBe(350);
    expect(excluded).toBe(0);
  });

  /**
   * The bug this function exists to stop. Every caller used to reduce over
   * `expenseAmount`, which falls back to the raw amount — so with no FX pass
   * the seed data's USD and EUR rows were added to INR at 1:1 and the result
   * presented as a rupee total.
   */
  it('leaves foreign-currency rows out of the total and counts them', () => {
    const { total, excluded } = sumSpend([
      expense({ id: 'a', amount: 1000, currency: 'INR' }),
      expense({ id: 'b', amount: 200, currency: 'USD', convertedAmount: null }),
      expense({ id: 'c', amount: 150, currency: 'EUR', convertedAmount: null }),
    ]);

    expect(total).toBe(1000);
    expect(excluded).toBe(2);
  });

  it('includes a foreign row once FX has converted it', () => {
    const { total, excluded } = sumSpend([
      expense({ id: 'a', amount: 1000, currency: 'INR' }),
      expense({ id: 'b', amount: 200, currency: 'USD', convertedAmount: 16_800 }),
    ]);

    expect(total).toBe(17_800);
    expect(excluded).toBe(0);
  });

  it('does not count a rejected foreign row as excluded — it is not spend either way', () => {
    const { total, excluded } = sumSpend([
      expense({ id: 'a', amount: 200, currency: 'USD', status: 'rejected' }),
    ]);

    expect(total).toBe(0);
    expect(excluded).toBe(0);
  });

  it('skips rejected and deleted rows, as isSpend says', () => {
    const rows = [
      expense({ id: 'a', amount: 100 }),
      expense({ id: 'b', amount: 400, status: 'rejected' }),
      expense({ id: 'c', amount: 700, deletedAt: '2026-08-11T00:00:00.000Z' }),
    ];

    expect(rows.filter(isSpend)).toHaveLength(1);
    expect(sumSpend(rows).total).toBe(100);
  });

  /**
   * Aligns with the server-side rule in `sumByCategory`. Drafts are uncommitted
   * intent, not spend — counting them would make the dashboard disagree with
   * `/budgets/status`.
   */
  it('excludes drafts — uncommitted intent is not spend', () => {
    const rows = [
      expense({ id: 'a', amount: 500, status: 'draft' }),
      expense({ id: 'b', amount: 300, status: 'submitted' }),
    ];

    expect(isSpend(rows[0])).toBe(false);
    expect(isSpend(rows[1])).toBe(true);
    expect(sumSpend(rows).total).toBe(300);
  });

  it('is zero on an empty list', () => {
    expect(sumSpend([])).toEqual({ total: 0, excluded: 0 });
  });
});

describe('expenseAmount', () => {
  it('prefers the converted amount, which is the only cross-currency-safe figure', () => {
    expect(expenseAmount(expense({ amount: 50, currency: 'USD', convertedAmount: 4200 }))).toBe(
      4200,
    );
  });

  it('falls back to the filed amount for a single row, which is what to print', () => {
    expect(expenseAmount(expense({ amount: 250, convertedAmount: null }))).toBe(250);
  });

  it('never returns NaN', () => {
    expect(expenseAmount(expense({ amount: Number.NaN, convertedAmount: null }))).toBe(0);
  });
});

describe('a row the FX pass has locked a rate onto', () => {
  // The point of the whole design: nothing in this file changed to make these
  // pass. A foreign row re-enters every total the moment `convertedAmount` is
  // filled, which is what `sumSpend()` was written to allow.
  const locked = expense({
    amount: 20,
    currency: 'USD',
    convertedAmount: 1908.6,
    fxRate: 95.43,
    fxRateDate: '2026-08-14',
    baseCurrency: 'INR',
  });

  it('counts as converted', () => {
    expect(isConverted(locked)).toBe(true);
  });

  it('is labelled in the base currency, not the one it was filed in', () => {
    expect(expenseCurrency(locked)).toBe('INR');
    expect(expenseAmount(locked)).toBe(1908.6);
  });

  it('is added to the total rather than excluded from it', () => {
    expect(sumSpend([locked])).toEqual({ total: 1908.6, excluded: 0 });
  });

  it('is still excluded when the rate could not be locked', () => {
    const unlocked = expense({ currency: 'USD', convertedAmount: null, fxRate: null });
    expect(sumSpend([unlocked])).toEqual({ total: 0, excluded: 1 });
  });
});

describe('excludedNotice', () => {
  it('says nothing when nothing was excluded', () => {
    expect(excludedNotice(0)).toBeNull();
  });

  it('reads as a sentence in the singular', () => {
    expect(excludedNotice(1)).toContain('1 expense in other currencies isn’t included');
  });

  it('reads as a sentence in the plural', () => {
    expect(excludedNotice(3)).toContain('3 expenses in other currencies aren’t included');
  });
});
