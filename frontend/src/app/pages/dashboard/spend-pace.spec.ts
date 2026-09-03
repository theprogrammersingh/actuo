import type { Expense } from '@actuo/shared';
import { describe, expect, it } from 'vitest';

import { formatDate, formatDay, formatMoney } from '../../core/format/money.js';
import {
  barGeometry,
  computeSpendPace,
  dailyTrend,
  expenseAmount,
  isSpend,
  monthKey,
  pendingCount,
  recentActivity,
  spendWindow,
  totalForMonth,
} from './spend-pace.js';

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

describe('expenseAmount', () => {
  it('prefers the converted amount, which is the only cross-currency-safe figure', () => {
    expect(expenseAmount(expense({ amount: 50, currency: 'USD', convertedAmount: 4200 }))).toBe(
      4200,
    );
  });

  it('falls back to the filed amount when nothing was converted', () => {
    expect(expenseAmount(expense({ amount: 250, convertedAmount: null }))).toBe(250);
  });

  it('treats a non-finite amount as zero rather than poisoning every total', () => {
    expect(expenseAmount(expense({ amount: Number.NaN, convertedAmount: null }))).toBe(0);
  });
});

describe('isSpend', () => {
  it.each(['submitted', 'approved', 'reimbursed'] as const)('counts %s', (status) => {
    expect(isSpend(expense({ status }))).toBe(true);
  });

  it('excludes draft — uncommitted intent, not spend (aligns with server)', () => {
    expect(isSpend(expense({ status: 'draft' }))).toBe(false);
  });

  it('excludes rejected — the org decided it will not bear that cost', () => {
    expect(isSpend(expense({ status: 'rejected' }))).toBe(false);
  });

  it('excludes soft-deleted rows', () => {
    expect(isSpend(expense({ deletedAt: '2026-08-11T00:00:00.000Z' }))).toBe(false);
  });
});

describe('monthKey', () => {
  it('slices the string rather than parsing a Date, so it is timezone-free', () => {
    expect(monthKey('2026-01-01')).toBe('2026-01');
    expect(monthKey('2026-12-31')).toBe('2026-12');
  });
});

describe('spendWindow', () => {
  it('reaches back to the first of last month so pace has a fallback benchmark', () => {
    const window = spendWindow(new Date(2026, 7, 14)); // 14 Aug 2026
    expect(window).toMatchObject({
      from: '2026-07-01',
      to: '2026-08-14',
      month: '2026-08',
      previousMonth: '2026-07',
      dayOfMonth: 14,
      daysInMonth: 31,
    });
  });

  it('rolls the previous month across a year boundary', () => {
    expect(spendWindow(new Date(2026, 0, 3))).toMatchObject({
      from: '2025-12-01',
      previousMonth: '2025-12',
      month: '2026-01',
      to: '2026-01-03',
    });
  });

  it('knows February in a leap year', () => {
    expect(spendWindow(new Date(2028, 1, 1)).daysInMonth).toBe(29);
  });
});

describe('totalForMonth', () => {
  const rows = [
    expense({ id: 'a', expenseDate: '2026-08-02', amount: 100 }),
    expense({ id: 'b', expenseDate: '2026-08-20', amount: 250 }),
    expense({ id: 'c', expenseDate: '2026-07-30', amount: 999 }),
    expense({ id: 'd', expenseDate: '2026-08-21', amount: 400, status: 'rejected' }),
  ];

  it('sums only the requested month', () => {
    expect(totalForMonth(rows, '2026-08').total).toBe(350);
    expect(totalForMonth(rows, '2026-07').total).toBe(999);
  });

  it('is zero for a month with nothing in it', () => {
    expect(totalForMonth(rows, '2026-09').total).toBe(0);
  });
});

describe('pendingCount', () => {
  it('counts only submitted rows — the ones a human still has to decide', () => {
    expect(
      pendingCount([
        expense({ id: 'a', status: 'submitted' }),
        expense({ id: 'b', status: 'submitted' }),
        expense({ id: 'c', status: 'approved' }),
        expense({ id: 'd', status: 'draft' }),
      ]),
    ).toBe(2);
  });
});

describe('computeSpendPace', () => {
  const halfway = { dayOfMonth: 15, daysInMonth: 30 };

  it('projects the month linearly from the elapsed fraction', () => {
    const pace = computeSpendPace({ spent: 500, budgeted: 1000, lastMonthSpend: 0, ...halfway });
    expect(pace.elapsed).toBe(0.5);
    expect(pace.projected).toBe(1000);
    expect(pace.ratio).toBe(1);
  });

  it('is on track while the projection stays under 90% of the benchmark', () => {
    expect(
      computeSpendPace({ spent: 400, budgeted: 1000, lastMonthSpend: 0, ...halfway }).status,
    ).toBe('on-track');
  });

  it('warns once the projection closes on the benchmark', () => {
    expect(
      computeSpendPace({ spent: 470, budgeted: 1000, lastMonthSpend: 0, ...halfway }).status,
    ).toBe('watch');
  });

  it('calls it over as soon as the projection reaches the benchmark', () => {
    expect(
      computeSpendPace({ spent: 500, budgeted: 1000, lastMonthSpend: 0, ...halfway }).status,
    ).toBe('over');
  });

  it('falls back to last month when no budget is set', () => {
    const pace = computeSpendPace({ spent: 300, budgeted: 0, lastMonthSpend: 900, ...halfway });
    expect(pace.benchmarkSource).toBe('last-month');
    expect(pace.benchmark).toBe(900);
  });

  it('prefers a budget over last month when both exist', () => {
    const pace = computeSpendPace({ spent: 300, budgeted: 1200, lastMonthSpend: 900, ...halfway });
    expect(pace.benchmarkSource).toBe('budget');
    expect(pace.benchmark).toBe(1200);
  });

  it('makes no claim at all when there is nothing to pace against', () => {
    const pace = computeSpendPace({ spent: 300, budgeted: 0, lastMonthSpend: 0, ...halfway });
    expect(pace.benchmarkSource).toBe('none');
    expect(pace.ratio).toBe(0);
    expect(pace.status).toBe('on-track');
  });

  it('does not divide by zero on day zero or a zero-length month', () => {
    const pace = computeSpendPace({
      spent: 100,
      budgeted: 1000,
      lastMonthSpend: 0,
      dayOfMonth: 0,
      daysInMonth: 0,
    });
    expect(Number.isFinite(pace.projected)).toBe(true);
    expect(pace.projected).toBe(0);
  });

  it('never reports more than a full month elapsed', () => {
    expect(
      computeSpendPace({
        spent: 100,
        budgeted: 1000,
        lastMonthSpend: 0,
        dayOfMonth: 31,
        daysInMonth: 30,
      }).elapsed,
    ).toBe(1);
  });
});

describe('dailyTrend', () => {
  it('returns one point per day, oldest first, ending on the given day', () => {
    const points = dailyTrend([], '2026-08-14', 5);
    expect(points.map((point) => point.date)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
  });

  it('keeps empty days as explicit zeros so the axis does not lie', () => {
    const points = dailyTrend(
      [expense({ expenseDate: '2026-08-13', amount: 60 })],
      '2026-08-14',
      3,
    );
    expect(points.map((point) => point.total)).toEqual([0, 60, 0]);
  });

  it('adds up several expenses on the same day', () => {
    const points = dailyTrend(
      [
        expense({ id: 'a', expenseDate: '2026-08-14', amount: 40 }),
        expense({ id: 'b', expenseDate: '2026-08-14', amount: 60 }),
        expense({ id: 'c', expenseDate: '2026-08-14', amount: 500, status: 'rejected' }),
      ],
      '2026-08-14',
      1,
    );
    expect(points[0].total).toBe(100);
  });

  it('crosses a month boundary correctly', () => {
    expect(dailyTrend([], '2026-03-02', 3).map((point) => point.date)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

describe('barGeometry', () => {
  it('scales the tallest bar to the full height', () => {
    const bars = barGeometry([1, 2, 4], { width: 100, height: 40, gap: 0, baseline: 0 });
    expect(bars[2].height).toBe(40);
    expect(bars[1].height).toBe(20);
    expect(bars[2].y).toBe(0);
  });

  it('lays bars out left to right without overlapping', () => {
    const bars = barGeometry([1, 1, 1, 1], { width: 100, height: 40, gap: 0, baseline: 0 });
    expect(bars.map((bar) => bar.x)).toEqual([0, 25, 50, 75]);
    expect(bars[0].width).toBe(25);
  });

  it('does not paint a full-height chart when every day is zero', () => {
    const bars = barGeometry([0, 0, 0], { width: 100, height: 40, gap: 0, baseline: 1 });
    expect(bars.every((bar) => bar.height === 1)).toBe(true);
  });

  it('returns nothing for no values', () => {
    expect(barGeometry([])).toEqual([]);
  });
});

describe('recentActivity', () => {
  it('sorts by when it was filed, not the date it happened', () => {
    const rows = [
      expense({ id: 'old', expenseDate: '2026-08-20', createdAt: '2026-08-20T08:00:00.000Z' }),
      expense({ id: 'new', expenseDate: '2026-08-01', createdAt: '2026-08-21T08:00:00.000Z' }),
    ];
    expect(recentActivity(rows).map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('caps the feed and leaves the input untouched', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      expense({
        id: `e${index}`,
        createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    expect(recentActivity(rows, 3)).toHaveLength(3);
    expect(rows[0].id).toBe('e0');
  });
});

describe('formatMoney', () => {
  it('groups Indian-style and drops the paise', () => {
    expect(formatMoney(124500, 'INR')).toBe('₹1,24,500');
  });

  it('renders any currency the org uses', () => {
    expect(formatMoney(1200, 'USD')).toContain('1,200');
  });

  it('degrades to a bare number rather than throwing on a bad currency code', () => {
    expect(formatMoney(1200, 'not-a-currency')).toBe('1,200');
  });

  it('shows an em dash for a non-finite amount', () => {
    expect(formatMoney(Number.NaN, 'INR')).toBe('—');
  });
});

describe('formatDay / formatDate', () => {
  it('splits the date string by hand so no timezone can shift the day', () => {
    expect(formatDay('2026-01-01')).toBe('1 Jan');
    expect(formatDay('2026-12-31')).toBe('31 Dec');
    expect(formatDate('2026-08-27')).toBe('27 Aug 2026');
  });

  it('passes an unparseable value straight through', () => {
    expect(formatDay('later')).toBe('later');
    expect(formatDate('later')).toBe('later');
  });
});
