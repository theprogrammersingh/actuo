/**
 * Budget arithmetic for the budgets screen.
 *
 * `GET /api/budgets/status` already returns per-category `spent`, `remaining`
 * and `utilization`, so nothing here recomputes them — the server is the source
 * of truth for the numbers. What this file does is guard them (a category with
 * a zero budget yields a non-finite utilization), order them, and roll them up,
 * all as pure functions so the ordering and the totals are testable directly.
 */

import type { BudgetStatus } from '@actuo/shared';

/**
 * Utilization as a percentage for `ProgressBar`, which takes a 0–100 value.
 *
 * Values above 100 are passed through deliberately: the bar clamps its own fill
 * but needs the true figure to report "Over by N%".
 */
export function utilizationPercent(status: BudgetStatus): number {
  const raw = status.utilization * 100;
  if (Number.isFinite(raw)) return Math.max(raw, 0);
  // budgeted = 0 makes the server's ratio infinite. Anything spent against a
  // category with no budget is over it by definition; nothing spent is not.
  return status.spent > 0 ? 100 : 0;
}

export function isOverBudget(status: BudgetStatus): boolean {
  return status.spent > status.budgeted;
}

/** How much a category has overshot by. Zero when it has not. */
export function overspend(status: BudgetStatus): number {
  return Math.max(status.spent - status.budgeted, 0);
}

/**
 * Tightest first.
 *
 * The point of this screen is to find the categories in trouble, so the ones
 * closest to (or past) their limit are what should be visible without
 * scrolling. Ties fall back to the category name so the order is total and the
 * list does not reshuffle between loads.
 */
export function sortBudgets(statuses: readonly BudgetStatus[]): BudgetStatus[] {
  return [...statuses].sort((a, b) => {
    const difference = utilizationPercent(b) - utilizationPercent(a);
    if (difference !== 0) return difference;
    return a.categoryName.localeCompare(b.categoryName);
  });
}

export function overBudget(statuses: readonly BudgetStatus[]): BudgetStatus[] {
  return statuses.filter(isOverBudget);
}

export interface BudgetRollup {
  budgeted: number;
  spent: number;
  /** Can go negative — an org can be over budget overall. */
  remaining: number;
  /** 0–1+, across every category with a budget. */
  utilization: number;
  categoryCount: number;
  overCount: number;
  /** Total overshoot across the categories that are over. */
  overspend: number;
  currency: string;
  /**
   * Expenses in the window that no figure above accounts for, because they are
   * in another currency and no converted value exists yet (PRD §6.5). Summed
   * across categories, so it is the count for the whole screen.
   */
  unconvertedCount: number;
}

const EMPTY: BudgetRollup = {
  budgeted: 0,
  spent: 0,
  remaining: 0,
  utilization: 0,
  categoryCount: 0,
  overCount: 0,
  overspend: 0,
  currency: '',
  unconvertedCount: 0,
};

/**
 * Org-wide totals.
 *
 * `remaining` is summed from the server's per-category figure rather than
 * derived as `budgeted - spent`: a category that is over budget reports a
 * negative remaining, and summing that is what makes the headline agree with
 * the rows underneath it.
 */
export function rollupBudgets(statuses: readonly BudgetStatus[]): BudgetRollup {
  if (statuses.length === 0) return { ...EMPTY };

  const budgeted = statuses.reduce((sum, status) => sum + status.budgeted, 0);
  const spent = statuses.reduce((sum, status) => sum + status.spent, 0);
  const remaining = statuses.reduce((sum, status) => sum + status.remaining, 0);
  const over = overBudget(statuses);

  return {
    budgeted,
    spent,
    remaining,
    utilization: budgeted > 0 ? spent / budgeted : 0,
    categoryCount: statuses.length,
    overCount: over.length,
    overspend: over.reduce((sum, status) => sum + overspend(status), 0),
    // Every category in one org shares the base currency; the first is enough.
    currency: statuses[0].currency,
    unconvertedCount: statuses.reduce((sum, status) => sum + (status.unconvertedCount ?? 0), 0),
  };
}
