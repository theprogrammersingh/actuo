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

/**
 * The user-facing action names, and the status each one moves an expense to.
 *
 * These three tables live here rather than in `backend/` for the reason the
 * legality table does: the UI has to offer exactly the actions the server will
 * accept, and a second copy would drift. The frontend may not import from
 * `backend/` (that is a structural boundary, not a preference), so anything
 * both sides need belongs in `@actuo/shared`.
 *
 * What stays server-only is the *enforcement* — which HTTP failure an illegal
 * move produces, and the ownership check — in
 * `backend/src/expenses/expense-state-machine.ts`.
 */
export const TRANSITION_ACTIONS = {
  submit: 'submitted',
  approve: 'approved',
  reject: 'rejected',
  reimburse: 'reimbursed',
  /** rejected -> draft: pull a rejected expense back for rework. */
  rework: 'draft',
} as const satisfies Record<string, ExpenseStatus>;

export type TransitionAction = keyof typeof TRANSITION_ACTIONS;

/**
 * Which roles may perform each transition.
 *
 * `submit` is open to `member` because submitting your own expense is the whole
 * point of the member role — ownership of the row is checked separately.
 * Everything downstream of submission is an approver action and excludes
 * `member` (PRD §6.4). This is the table the RBAC e2e test pins down.
 */
export const TRANSITION_ROLES: Readonly<Record<TransitionAction, readonly Role[]>> = {
  submit: ['owner', 'admin', 'member'],
  approve: ['owner', 'admin'],
  reject: ['owner', 'admin'],
  reimburse: ['owner', 'admin'],
  rework: ['owner', 'admin', 'member'],
};

/**
 * Actions only the expense's own submitter may perform. Approvers may perform
 * them on anyone's row; the server does the ownership check, and the UI uses
 * this list to avoid offering a button that would 403.
 */
export const OWNER_ONLY_ACTIONS: readonly TransitionAction[] = ['submit', 'rework'];

/** The roles that may decide on someone else's expense. */
export const APPROVER_ROLES: readonly Role[] = ['owner', 'admin'];

export function isApprover(role: Role | null | undefined): boolean {
  return role != null && APPROVER_ROLES.includes(role);
}

/**
 * Actions nobody may perform on their **own** expense, whatever their role.
 *
 * Segregation of duties: without this an admin could file a reimbursement and
 * approve it with nobody else involved. It is a separate rule from
 * `OWNER_ONLY_ACTIONS` and very nearly its inverse — one says "only yours", this
 * says "never yours".
 */
export const NOT_ON_OWN_ACTIONS: readonly TransitionAction[] = ['approve', 'reject'];

/** Statuses with nowhere left to go. `reimbursed` is the only true terminal. */
export const TERMINAL_STATUSES: readonly ExpenseStatus[] = (
  Object.keys(EXPENSE_TRANSITIONS) as ExpenseStatus[]
).filter((status) => EXPENSE_TRANSITIONS[status].length === 0);

/** The status `action` moves an expense to. */
export function targetStatusFor(action: TransitionAction): ExpenseStatus {
  return TRANSITION_ACTIONS[action];
}

export function roleMayPerform(role: Role, action: TransitionAction): boolean {
  return TRANSITION_ROLES[action].includes(role);
}

/**
 * Whether `role` may perform `action` on an expense filed by `ownerId`.
 *
 * The single place both sides answer that question: `ExpensesService.transition`
 * enforces it, and the UI uses it to decide which buttons to render. Legality of
 * the *transition itself* is separate — see {@link canTransition}.
 */
export function mayPerformOn(
  role: Role | null | undefined,
  action: TransitionAction,
  ownerId: string | null,
  actorId: string | null,
): boolean {
  if (role == null || !roleMayPerform(role, action)) return false;

  const isOwnRow = ownerId !== null && ownerId === actorId;
  if (NOT_ON_OWN_ACTIONS.includes(action) && isOwnRow) return false;
  // Owner-only actions on someone else's row are an approver's privilege.
  if (OWNER_ONLY_ACTIONS.includes(action) && !isOwnRow) return isApprover(role);

  return true;
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
  /**
   * The rate locked at write time — 1 unit of `currency` in `baseCurrency` —
   * and the day that rate is from (PRD §6.5).
   *
   * `fxRateDate` is not always `expenseDate`. The ECB publishes once per
   * working day, so an expense filed on a Sunday locks Friday's rate, and
   * saying which day it came from is the difference between an auditable
   * figure and a number nobody can defend.
   *
   * Both are null together, and that is the honest "no rate could be locked"
   * state: `convertedAmount` is null too, and the row is excluded from totals
   * and counted rather than added at face value.
   */
  fxRate: number | null;
  fxRateDate: string | null;
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
/**
 * A row of `audit_log` — what changed, who changed it, and when (PRD §6.2).
 *
 * Distinct from {@link ToolCallLogEntry} on purpose, and the two are easy to
 * confuse: `audit_log` records **state changes**, written server-side on every
 * mutation regardless of who caused it; `tool_call_log` records **WebMCP tool
 * invocations**, written by the browser. Approving an expense from the UI
 * produces an audit row and no tool-call row; a Copilot search produces a
 * tool-call row and no audit row.
 */
export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorId: string | null;
  /** Verb, e.g. `expense.approved`. */
  action: string;
  /** The kind of thing that changed, e.g. `expense`. */
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ToolCallLogEntry {
  id: string;
  orgId: string;
  actor: 'human' | 'agent';
  toolName: string;
  input: unknown;
  output: unknown;
  createdAt: string;
}
