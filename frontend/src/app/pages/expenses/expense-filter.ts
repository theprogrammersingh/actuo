/**
 * Table state for the expenses screen: what is shown, and in what order.
 *
 * Filtering and sorting both run in the browser over one fetched page. That is
 * a deliberate trade at this scale — the API has no sort parameter, so doing
 * half the work on the server and half here would let the two disagree about
 * which rows the sort applies to. It also makes typing in the search box
 * instant instead of a debounce plus a round trip. When volume outgrows a
 * single page, move `text`/`status` into the resource params and let
 * `/expenses/search` do the filtering.
 *
 * Everything here is pure, so the behaviour that actually matters — what
 * matches, what order it lands in — is testable without rendering a table.
 */

import type { Expense, ExpenseStatus } from '@actuo/shared';

import { expenseAmount } from '../../core/expense/amount.js';

export type StatusFilter = ExpenseStatus | 'all';

export type SortKey = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

export interface Sort {
  key: SortKey;
  direction: SortDirection;
}

export interface TableFilter {
  text: string;
  status: StatusFilter;
}

/** Newest first: the row a user came to find is almost always a recent one. */
export const DEFAULT_SORT: Sort = { key: 'date', direction: 'desc' };

export const DEFAULT_FILTER: TableFilter = { text: '', status: 'all' };

/** Whether anything is narrowing the list — drives "no results" vs "no expenses". */
export function isFiltering(filter: TableFilter): boolean {
  return filter.text.trim() !== '' || filter.status !== 'all';
}

/**
 * Free text matches the merchant, the note, or the amount as typed.
 *
 * Amount is included because "1200" is a completely natural way to look for an
 * expense, and it would otherwise match nothing. Matching is case-insensitive
 * and substring-based; there is no fuzzy matching, so results never surprise.
 */
export function matchesText(expense: Expense, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === '') return true;

  const haystack = [
    expense.merchant ?? '',
    expense.note ?? '',
    String(expenseAmount(expense)),
    expense.currency,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

export function matchesFilter(expense: Expense, filter: TableFilter): boolean {
  if (filter.status !== 'all' && expense.status !== filter.status) return false;
  return matchesText(expense, filter.text);
}

export function filterExpenses(expenses: readonly Expense[], filter: TableFilter): Expense[] {
  return expenses.filter((expense) => matchesFilter(expense, filter));
}

function compare(a: Expense, b: Expense, key: SortKey): number {
  if (key === 'amount') return expenseAmount(a) - expenseAmount(b);
  // Date-only ISO strings sort correctly lexicographically, so no Date parsing
  // — and therefore no timezone — is involved.
  return a.expenseDate < b.expenseDate ? -1 : a.expenseDate > b.expenseDate ? 1 : 0;
}

/**
 * Sorts a copy, never the input.
 *
 * Ties break on `createdAt` and then `id` so the order is total: without that,
 * five expenses on the same day would shuffle between renders, which reads as a
 * bug even though every row is still present.
 */
export function sortExpenses(expenses: readonly Expense[], sort: Sort): Expense[] {
  const sign = sort.direction === 'asc' ? 1 : -1;

  return [...expenses].sort((a, b) => {
    const primary = compare(a, b, sort.key);
    if (primary !== 0) return primary * sign;

    if (a.createdAt !== b.createdAt) return (a.createdAt < b.createdAt ? -1 : 1) * sign;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * What clicking a column header does.
 *
 * Re-clicking the active column flips the direction; switching columns starts
 * at `desc`, because both "most recent" and "largest" are what someone is
 * looking for when they first reach for that header.
 */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, direction: 'desc' };
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}

/** `aria-sort` for a column header — `none` unless this is the active column. */
export function ariaSort(current: Sort, key: SortKey): 'ascending' | 'descending' | 'none' {
  if (current.key !== key) return 'none';
  return current.direction === 'asc' ? 'ascending' : 'descending';
}

export function applyTableState(
  expenses: readonly Expense[],
  filter: TableFilter,
  sort: Sort,
): Expense[] {
  return sortExpenses(filterExpenses(expenses, filter), sort);
}

/** The status dropdown's options, in lifecycle order. */
export const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'reimbursed', label: 'Reimbursed' },
];
