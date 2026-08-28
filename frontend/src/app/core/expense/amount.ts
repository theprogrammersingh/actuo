import type { Expense } from '@actuo/shared';

/**
 * Which amount field counts, and which rows count at all.
 *
 * These two rules are shared by every screen that totals money — dashboard,
 * expenses, budgets — so they live here rather than in any one feature. If they
 * ever disagree between screens the app contradicts itself about how much was
 * spent, which is the worst possible bug in a finance tool.
 */

/**
 * `convertedAmount` is the value in the org's base currency; `amount` is
 * whatever currency the user filed in. Summing `amount` across currencies would
 * silently add rupees to dollars, so the converted value always wins when
 * present.
 */
export function expenseAmount(expense: Expense): number {
  const value = expense.convertedAmount ?? expense.amount;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Whether a row counts as spend.
 *
 * Rejected expenses are excluded: the org decided it will not bear that cost,
 * so counting it would overstate every total. Drafts *are* counted — that money
 * has already left a person's pocket, it just has not been claimed yet, and
 * hiding it makes the dashboard disagree with the user's own wallet.
 * Soft-deleted rows are excluded defensively; the backend already filters them.
 */
export function isSpend(expense: Expense): boolean {
  return expense.status !== 'rejected' && expense.deletedAt === null;
}
