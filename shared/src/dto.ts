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
  budgeted: number;
  spent: number;
  remaining: number;
  /** 0–1+; can exceed 1 when over budget. Drives the progress-bar color ramp. */
  utilization: number;
  currency: string;
}
