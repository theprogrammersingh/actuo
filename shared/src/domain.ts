/**
 * Core domain types — the shape of the Supabase tables in PRD §8.7.
 *
 * These are the contract between `frontend/` and `backend/`. Neither side
 * defines its own copy: the frontend never talks to Supabase, so these types
 * describe what crosses the `/api/*` boundary.
 */

export type Role = 'owner' | 'admin' | 'member';

/** PRD §6.4 — the approval state machine. */
export type ExpenseStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'reimbursed';

/** Legal transitions. The backend is the only enforcer; the UI merely reflects it. */
export const EXPENSE_TRANSITIONS: Readonly<Record<ExpenseStatus, readonly ExpenseStatus[]>> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['reimbursed'],
  rejected: ['draft'],
  reimbursed: [],
} as const;

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return EXPENSE_TRANSITIONS[from].includes(to);
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  joinedAt: string;
}

export interface Category {
  id: string;
  orgId: string;
  name: string;
  icon: string | null;
  isDefault: boolean;
}

export interface Expense {
  id: string;
  orgId: string;
  userId: string;
  categoryId: string | null;
  amount: number;
  currency: string;
  convertedAmount: number | null;
  baseCurrency: string;
  merchant: string | null;
  note: string | null;
  status: ExpenseStatus;
  receiptUrl: string | null;
  expenseDate: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface Budget {
  id: string;
  orgId: string;
  categoryId: string | null;
  amount: number;
  period: 'monthly';
  rollover: boolean;
}

export interface Approval {
  id: string;
  expenseId: string;
  approverId: string;
  status: Extract<ExpenseStatus, 'approved' | 'rejected'>;
  comment: string | null;
  decidedAt: string;
}

/**
 * PRD §8.7 — every WebMCP tool invocation is logged here, whether a human
 * clicked it or an agent called it. Doubles as the audit trail and the demo
 * artifact ("here is everything the agent did this session").
 */
export interface ToolCallLogEntry {
  id: string;
  orgId: string;
  actor: 'human' | 'agent';
  toolName: string;
  input: unknown;
  output: unknown;
  createdAt: string;
}
