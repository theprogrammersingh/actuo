/** Request/response payloads for the `/api/*` surface (PRD §8.6). */

import type { Expense, ExpenseStatus, Role, User } from './domain.js';

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  orgName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  orgId: string;
  role: Role;
}

export interface CreateExpenseRequest {
  amount: number;
  currency: string;
  categoryId?: string | null;
  merchant?: string | null;
  note?: string | null;
  expenseDate: string;
}

export type UpdateExpenseRequest = Partial<CreateExpenseRequest> & {
  status?: ExpenseStatus;
};

export interface SearchExpensesQuery {
  query?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Page-size contract for expense listings.
 *
 * These live here because the cap is a *contract*, not a backend detail: the
 * validation DTO, the service clamp, the `search_expenses` tool schema and every
 * frontend call site all have to agree on it. They previously did not — the
 * Expenses page asked for 200 and got a 400, while report generation asked for
 * 500 and was silently clamped to 100, producing CSVs that omitted rows without
 * saying so.
 *
 * Anything needing every row must paginate rather than raise a limit; see
 * `fetchAllPages` in `pagination.ts`.
 */
export const EXPENSE_PAGE_DEFAULT = 20;
export const EXPENSE_PAGE_MAX = 100;

/** All list endpoints paginate (PRD §9 performance). */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type ExpensePage = Page<Expense>;

export interface BudgetStatus {
  categoryId: string | null;
  categoryName: string;
  /**
   * The effective budget: `declaredBudget + carryforward`. This is what
   * utilization is measured against. For budgets without rollover, it equals
   * `declaredBudget`.
   */
  budgeted: number;
  /**
   * The declared budget amount, before any rollover adjustment. Separate from
   * `budgeted` so the UI can state the carry explicitly: "₹50,000 + ₹8,000
   * carried over".
   */
  declaredBudget: number;
  /**
   * Unspent budget carried from the previous period (PRD §6.3). Zero when
   * rollover is off or the budget had no underspend to carry.
   */
  carryforward: number;
  spent: number;
  remaining: number;
  /** 0–1+; can exceed 1 when over budget. Drives the progress-bar color ramp. */
  utilization: number;
  currency: string;
  /**
   * How many expenses in this window were left out of `spent` because they are
   * not in `currency` and no converted value exists yet (PRD §6.5 — FX is not
   * implemented).
   *
   * It is reported rather than folded in because the alternative is worse: the
   * old code added the raw foreign amount, so a $200 charge was counted as ₹200.
   * A total that says what it excluded is honest; one that silently adds
   * dollars to rupees is not. Zero once a real FX pass fills `converted_amount`.
   */
  unconvertedCount: number;
}

/** Spend breakdown by category for the analytics summary. */
export interface CategorySpend {
  categoryId: string | null;
  categoryName: string;
  /** Absolute spend in the org's base currency. */
  spent: number;
  /** Fraction of monthSpend this category represents (0–1). */
  share: number;
}

/**
 * Month-over-month analytics summary for the dashboard hero tile and the
 * `get_analytics_summary` WebMCP tool.
 */
export interface AnalyticsSummary {
  /** YYYY-MM of the reporting window. */
  month: string;
  /** Org's base currency (all figures are in this currency). */
  currency: string;
  /** Total approved spend in the current window. */
  monthSpend: number;
  /** Total approved spend in the previous window. */
  previousMonthSpend: number;
  /** Percentage change ((current/prev - 1) * 100); null when prev = 0. */
  monthOverMonthDelta: number | null;
  /** Spend by category, sorted descending by spent. */
  byCategory: CategorySpend[];
  /** Expenses excluded for lack of a converted amount. */
  unconvertedCount: number;
  /** Draft expenses not counted in spend (they are not approved). */
  draftCount: number;
}
