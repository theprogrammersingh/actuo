import type { Expense, ExpenseStatus } from '@actuo/shared';

/**
 * Which amount field counts, and which rows count at all.
 *
 * These rules are shared by every screen that totals money — dashboard,
 * expenses, budgets — so they live here rather than in any one feature. If they
 * ever disagree between screens the app contradicts itself about how much was
 * spent, which is the worst possible bug in a finance tool.
 */

/**
 * `convertedAmount` is the value in the org's base currency; `amount` is
 * whatever currency the user filed in.
 *
 * This is the value for **one row** — what to print next to it, and what to
 * sort it by. It is not safe to add across rows: see {@link sumSpend}.
 */
export function expenseAmount(expense: Expense): number {
  const value = expense.convertedAmount ?? expense.amount;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Whether this row's value is expressed in the org's base currency.
 *
 * `convertedAmount` is filled by the FX pass (PRD §6.5) from the ECB rate on
 * the expense's own date, and stays `null` when no rate could be locked — an
 * unreachable publisher, or a currency the ECB does not publish. Anything
 * false here is a number in a *different unit*, and the currency to print
 * beside it is `expense.currency`, not `expense.baseCurrency`.
 */
export function isConverted(expense: Expense): boolean {
  return expense.convertedAmount !== null || expense.currency === expense.baseCurrency;
}

/** The currency symbol a single row must be labelled with. */
export function expenseCurrency(expense: Expense): string {
  return isConverted(expense) ? expense.baseCurrency || expense.currency : expense.currency;
}

/**
 * Statuses that count as spend. Matches the server-side rule in
 * `sumByCategory` so every surface agrees on the same total.
 *
 * - `submitted` — claimed but not yet decided
 * - `approved` — the org has agreed to bear this cost
 * - `reimbursed` — paid out, the final state
 *
 * Drafts are excluded: they are uncommitted intent, and counting them would
 * make the dashboard disagree with `/budgets/status`. Rejected expenses are
 * excluded: the org decided it will not bear that cost. Soft-deleted rows are
 * excluded defensively; the backend already filters them.
 */
const SPEND_STATUSES: ReadonlySet<ExpenseStatus> = new Set([
  'submitted',
  'approved',
  'reimbursed',
]);

export function isSpend(expense: Expense): boolean {
  return SPEND_STATUSES.has(expense.status) && expense.deletedAt === null;
}

/** A total, plus what it could not account for. */
export interface SpendTotal {
  /** Sum of qualifying rows that are in the base currency. */
  total: number;
  /** Qualifying rows left out because they are in another currency. */
  excluded: number;
}

/**
 * Total spend across rows — the only safe way to add expenses together.
 *
 * Every caller used to `reduce` over `expenseAmount`, which falls back to the
 * raw `amount` when there is no converted value. With no FX pass that meant
 * every foreign row was added at face value: the seed data alone has INR, USD
 * and EUR, so the dashboard was adding dollars to rupees at 1:1 and presenting
 * the result as a rupee figure.
 *
 * So unconvertible rows are excluded and **counted**. A total that says what it
 * left out is honest; one that quietly adds three currencies is not. The count
 * is what the UI needs to say so. When a real FX pass starts filling
 * `convertedAmount`, those rows re-enter the total with no change here.
 */
export function sumSpend(expenses: readonly Expense[]): SpendTotal {
  let total = 0;
  let excluded = 0;

  for (const expense of expenses) {
    if (!isSpend(expense)) continue;
    if (isConverted(expense)) total += expenseAmount(expense);
    else excluded += 1;
  }

  return { total, excluded };
}

/**
 * One line of copy for an excluded-rows notice, or `null` when nothing was.
 *
 * The copy used to say conversion "isn't live yet", which was true before the
 * FX pass and is not now. An excluded row today means no rate could be locked
 * for it, which is a narrower and rarer thing — and the reason it names the
 * rate rather than the feature.
 */
export function excludedNotice(excluded: number): string | null {
  if (excluded <= 0) return null;
  const noun = excluded === 1 ? 'expense' : 'expenses';
  const verb = excluded === 1 ? 'isn’t' : 'aren’t';
  return `${excluded} ${noun} in other currencies ${verb} included — no exchange rate could be locked for ${excluded === 1 ? 'it' : 'them'}.`;
}
