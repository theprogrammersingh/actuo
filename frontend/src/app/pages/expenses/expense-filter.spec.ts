import type { Expense } from '@actuo/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  applyTableState,
  ariaSort,
  filterExpenses,
  isFiltering,
  matchesText,
  nextSort,
  sortExpenses,
  type Sort,
} from './expense-filter.js';

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

const ROWS: Expense[] = [
  expense({
    id: 'a',
    merchant: 'Uber',
    amount: 320,
    expenseDate: '2026-08-01',
    status: 'approved',
  }),
  expense({
    id: 'b',
    merchant: 'Taj Hotel',
    note: 'Client dinner',
    amount: 4800,
    expenseDate: '2026-08-12',
    status: 'submitted',
  }),
  expense({
    id: 'c',
    merchant: 'Barista',
    amount: 180,
    expenseDate: '2026-08-07',
    status: 'draft',
  }),
];

describe('isFiltering', () => {
  it('is false for the untouched defaults', () => {
    expect(isFiltering(DEFAULT_FILTER)).toBe(false);
  });

  it('ignores whitespace typed into the search box', () => {
    expect(isFiltering({ text: '   ', status: 'all' })).toBe(false);
  });

  it('is true once either control is set', () => {
    expect(isFiltering({ text: 'uber', status: 'all' })).toBe(true);
    expect(isFiltering({ text: '', status: 'draft' })).toBe(true);
  });
});

describe('matchesText', () => {
  const row = expense({ merchant: 'Taj Hotel', note: 'Client dinner', amount: 4800 });

  it('matches everything when the box is empty', () => {
    expect(matchesText(row, '')).toBe(true);
    expect(matchesText(row, '  ')).toBe(true);
  });

  it('matches the merchant, case-insensitively', () => {
    expect(matchesText(row, 'taj')).toBe(true);
    expect(matchesText(row, 'TAJ')).toBe(true);
  });

  it('matches the note', () => {
    expect(matchesText(row, 'dinner')).toBe(true);
  });

  it('matches the amount, because typing a number to find a receipt is natural', () => {
    expect(matchesText(row, '4800')).toBe(true);
  });

  it('searches the converted amount, which is the figure the table shows', () => {
    const converted = expense({ amount: 60, currency: 'USD', convertedAmount: 5040 });
    expect(matchesText(converted, '5040')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesText(row, 'uber')).toBe(false);
  });

  it('survives a row with no merchant and no note', () => {
    expect(matchesText(expense({ merchant: null, note: null }), 'anything')).toBe(false);
  });
});

describe('filterExpenses', () => {
  it('passes everything through on the defaults', () => {
    expect(filterExpenses(ROWS, DEFAULT_FILTER)).toHaveLength(3);
  });

  it('narrows by status', () => {
    expect(filterExpenses(ROWS, { text: '', status: 'draft' }).map((row) => row.id)).toEqual(['c']);
  });

  it('applies text and status together, not as alternatives', () => {
    expect(filterExpenses(ROWS, { text: 'uber', status: 'draft' })).toEqual([]);
    expect(filterExpenses(ROWS, { text: 'uber', status: 'approved' }).map((row) => row.id)).toEqual(
      ['a'],
    );
  });
});

describe('sortExpenses', () => {
  it('defaults to newest first', () => {
    expect(sortExpenses(ROWS, DEFAULT_SORT).map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts oldest first when asked', () => {
    expect(sortExpenses(ROWS, { key: 'date', direction: 'asc' }).map((row) => row.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('sorts by amount in both directions', () => {
    expect(sortExpenses(ROWS, { key: 'amount', direction: 'desc' }).map((row) => row.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(sortExpenses(ROWS, { key: 'amount', direction: 'asc' }).map((row) => row.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('sorts on the converted amount, so a USD row lands where the table shows it', () => {
    const rows = [
      expense({ id: 'inr', amount: 1000, convertedAmount: null }),
      expense({ id: 'usd', amount: 60, currency: 'USD', convertedAmount: 5040 }),
    ];
    expect(sortExpenses(rows, { key: 'amount', direction: 'desc' }).map((row) => row.id)).toEqual([
      'usd',
      'inr',
    ]);
  });

  it('breaks ties deterministically instead of shuffling between renders', () => {
    const sameDay = [
      expense({ id: 'z', expenseDate: '2026-08-05', createdAt: '2026-08-05T10:00:00.000Z' }),
      expense({ id: 'y', expenseDate: '2026-08-05', createdAt: '2026-08-05T10:00:00.000Z' }),
    ];
    const once = sortExpenses(sameDay, DEFAULT_SORT).map((row) => row.id);
    const twice = sortExpenses([...sameDay].reverse(), DEFAULT_SORT).map((row) => row.id);
    expect(once).toEqual(twice);
  });

  it('never mutates its input', () => {
    const input = [...ROWS];
    sortExpenses(input, { key: 'amount', direction: 'asc' });
    expect(input.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nextSort', () => {
  it('flips direction when the active column is clicked again', () => {
    const first: Sort = { key: 'date', direction: 'desc' };
    expect(nextSort(first, 'date')).toEqual({ key: 'date', direction: 'asc' });
    expect(nextSort({ key: 'date', direction: 'asc' }, 'date')).toEqual({
      key: 'date',
      direction: 'desc',
    });
  });

  it('starts a new column at descending — largest and newest first', () => {
    expect(nextSort({ key: 'date', direction: 'asc' }, 'amount')).toEqual({
      key: 'amount',
      direction: 'desc',
    });
  });
});

describe('ariaSort', () => {
  it('reports none for inactive columns', () => {
    expect(ariaSort({ key: 'date', direction: 'desc' }, 'amount')).toBe('none');
  });

  it('maps the active column to the ARIA vocabulary', () => {
    expect(ariaSort({ key: 'date', direction: 'desc' }, 'date')).toBe('descending');
    expect(ariaSort({ key: 'amount', direction: 'asc' }, 'amount')).toBe('ascending');
  });
});

describe('applyTableState', () => {
  it('filters first, then sorts what survived', () => {
    const result = applyTableState(
      ROWS,
      { text: '', status: 'all' },
      { key: 'amount', direction: 'asc' },
    );
    expect(result.map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty list rather than throwing when nothing matches', () => {
    expect(applyTableState(ROWS, { text: 'nothing', status: 'all' }, DEFAULT_SORT)).toEqual([]);
  });
});
