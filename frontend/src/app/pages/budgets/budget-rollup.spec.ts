import type { BudgetStatus } from '@actuo/shared';
import { describe, expect, it } from 'vitest';

import {
  isNearBudget,
  isOverBudget,
  nearBudget,
  overBudget,
  overspend,
  rollupBudgets,
  sortBudgets,
  utilizationPercent,
  WARN_THRESHOLD,
} from './budget-rollup.js';

function budget(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  const declaredBudget = overrides.declaredBudget ?? overrides.budgeted ?? 10000;
  const carryforward = overrides.carryforward ?? 0;
  const budgeted = overrides.budgeted ?? declaredBudget + carryforward;
  const spent = overrides.spent ?? 3000;
  return {
    categoryId: 'cat-1',
    categoryName: 'Travel',
    budgeted,
    declaredBudget,
    carryforward,
    spent,
    remaining: budgeted - spent,
    utilization: budgeted > 0 ? spent / budgeted : Number.POSITIVE_INFINITY,
    currency: 'INR',
    unconvertedCount: 0,
    ...overrides,
  };
}

describe('utilizationPercent', () => {
  it('converts the server ratio to the 0–100 scale ProgressBar takes', () => {
    expect(utilizationPercent(budget({ budgeted: 1000, spent: 250 }))).toBe(25);
  });

  it('passes values above 100 through, so the bar can say how far over', () => {
    expect(utilizationPercent(budget({ budgeted: 1000, spent: 1400 }))).toBe(140);
  });

  it('treats spending against a zero budget as fully over, not as Infinity', () => {
    const value = utilizationPercent(budget({ budgeted: 0, spent: 500 }));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(100);
  });

  it('is zero for a zero budget with nothing spent', () => {
    expect(utilizationPercent(budget({ budgeted: 0, spent: 0, utilization: Number.NaN }))).toBe(0);
  });

  it('never goes negative', () => {
    expect(utilizationPercent(budget({ utilization: -0.5 }))).toBe(0);
  });
});

describe('isOverBudget / overspend', () => {
  it('is over only once spending passes the limit, not on reaching it', () => {
    expect(isOverBudget(budget({ budgeted: 1000, spent: 1000 }))).toBe(false);
    expect(isOverBudget(budget({ budgeted: 1000, spent: 1001 }))).toBe(true);
  });

  it('reports the overshoot, and zero when there is none', () => {
    expect(overspend(budget({ budgeted: 1000, spent: 1250 }))).toBe(250);
    expect(overspend(budget({ budgeted: 1000, spent: 400 }))).toBe(0);
  });
});

describe('isNearBudget / nearBudget (PRD §6.3 threshold alerts)', () => {
  it('exports the threshold constant so callers can reference it', () => {
    expect(WARN_THRESHOLD).toBe(0.8);
  });

  it('is true at exactly 80% utilization', () => {
    expect(isNearBudget(budget({ budgeted: 1000, spent: 800 }))).toBe(true);
  });

  it('is true between 80% and 100%', () => {
    expect(isNearBudget(budget({ budgeted: 1000, spent: 900 }))).toBe(true);
  });

  it('is false below the threshold', () => {
    expect(isNearBudget(budget({ budgeted: 1000, spent: 790 }))).toBe(false);
  });

  it('is false once over budget — that is a different state', () => {
    expect(isNearBudget(budget({ budgeted: 1000, spent: 1001 }))).toBe(false);
  });

  it('is false for a zero budget, rather than triggering on any spend', () => {
    expect(isNearBudget(budget({ budgeted: 0, spent: 500 }))).toBe(false);
  });

  it('filters to only the categories nearing their limit', () => {
    const rows = [
      budget({ categoryId: 'a', budgeted: 1000, spent: 850 }), // near
      budget({ categoryId: 'b', budgeted: 1000, spent: 500 }), // safe
      budget({ categoryId: 'c', budgeted: 1000, spent: 1200 }), // over
    ];
    expect(nearBudget(rows).map((r) => r.categoryId)).toEqual(['a']);
  });
});

describe('sortBudgets', () => {
  const rows = [
    budget({ categoryId: 'a', categoryName: 'Meals', budgeted: 1000, spent: 200 }),
    budget({ categoryId: 'b', categoryName: 'Travel', budgeted: 1000, spent: 1200 }),
    budget({ categoryId: 'c', categoryName: 'Software', budgeted: 1000, spent: 800 }),
  ];

  it('puts the tightest categories first, so trouble is above the fold', () => {
    expect(sortBudgets(rows).map((row) => row.categoryName)).toEqual([
      'Travel',
      'Software',
      'Meals',
    ]);
  });

  it('breaks ties by name so the list does not reshuffle between loads', () => {
    const tied = [
      budget({ categoryId: 'x', categoryName: 'Zebra', budgeted: 1000, spent: 500 }),
      budget({ categoryId: 'y', categoryName: 'Alpha', budgeted: 1000, spent: 500 }),
    ];
    expect(sortBudgets(tied).map((row) => row.categoryName)).toEqual(['Alpha', 'Zebra']);
  });

  it('never mutates its input', () => {
    const input = [...rows];
    sortBudgets(input);
    expect(input.map((row) => row.categoryId)).toEqual(['a', 'b', 'c']);
  });
});

describe('overBudget', () => {
  it('picks out only the categories past their limit', () => {
    const rows = [
      budget({ categoryId: 'a', budgeted: 1000, spent: 1200 }),
      budget({ categoryId: 'b', budgeted: 1000, spent: 900 }),
    ];
    expect(overBudget(rows).map((row) => row.categoryId)).toEqual(['a']);
  });
});

describe('rollupBudgets', () => {
  it('is all zeroes for no budgets, rather than NaN', () => {
    const rollup = rollupBudgets([]);
    expect(rollup).toMatchObject({ budgeted: 0, spent: 0, remaining: 0, utilization: 0 });
    expect(rollup.categoryCount).toBe(0);
  });

  it('adds up the server figures across categories', () => {
    const rollup = rollupBudgets([
      budget({ categoryId: 'a', budgeted: 1000, spent: 400 }),
      budget({ categoryId: 'b', budgeted: 3000, spent: 600 }),
    ]);
    expect(rollup).toMatchObject({
      budgeted: 4000,
      spent: 1000,
      remaining: 3000,
      utilization: 0.25,
    });
  });

  it('sums the negative remaining of an over-budget category, so the headline agrees with the rows', () => {
    const rollup = rollupBudgets([
      budget({ categoryId: 'a', budgeted: 1000, spent: 1500 }), // remaining -500
      budget({ categoryId: 'b', budgeted: 1000, spent: 200 }), // remaining  800
    ]);
    expect(rollup.remaining).toBe(300);
    expect(rollup.overCount).toBe(1);
    expect(rollup.overspend).toBe(500);
  });

  it('can report the org as over budget overall', () => {
    const rollup = rollupBudgets([budget({ budgeted: 1000, spent: 2500 })]);
    expect(rollup.remaining).toBe(-1500);
  });

  it('does not divide by zero when nothing is budgeted', () => {
    const rollup = rollupBudgets([budget({ budgeted: 0, spent: 500, remaining: -500 })]);
    expect(rollup.utilization).toBe(0);
    expect(Number.isFinite(rollup.utilization)).toBe(true);
  });

  it('carries the currency through for formatting', () => {
    expect(rollupBudgets([budget({ currency: 'USD' })]).currency).toBe('USD');
  });
});

describe('rollupBudgets — unconverted spend', () => {
  /**
   * `spent` counts only rows the server could express in the base currency, so
   * the screen has to be able to say what it left out. Summed across categories
   * because the notice is for the whole page, not per bar.
   */
  it('sums the unconverted counts across categories', () => {
    const rollup = rollupBudgets([
      budget({ categoryId: 'a', categoryName: 'Travel', unconvertedCount: 2 }),
      budget({ categoryId: 'b', categoryName: 'Meals', unconvertedCount: 1 }),
    ]);

    expect(rollup.unconvertedCount).toBe(3);
  });

  it('is zero when every expense was in the base currency', () => {
    expect(rollupBudgets([budget()]).unconvertedCount).toBe(0);
  });

  it('is zero for an empty list', () => {
    expect(rollupBudgets([]).unconvertedCount).toBe(0);
  });
});
