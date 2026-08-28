import { ConflictException } from '@nestjs/common';
import { EXPENSE_TRANSITIONS, canTransition, type ExpenseStatus, type Role } from '@actuo/shared';

/**
 * The approval workflow, PRD §6.4:
 *
 *   draft -> submitted -> approved -> reimbursed
 *                      \-> rejected -> draft
 *
 * The *legality* of a transition lives in `@actuo/shared` (`canTransition`,
 * `EXPENSE_TRANSITIONS`) so the UI can grey out impossible buttons using the
 * same table the server enforces. This file adds the two things the shared
 * table cannot express: which HTTP failure an illegal move produces, and *who*
 * is allowed to make each legal move.
 *
 * The server is the only enforcer. The UI merely reflects it.
 */

/** The user-facing action names, and the status each one moves an expense to. */
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
 * `submit` is open to `member` because submitting your own expense is the
 * whole point of the member role — ownership of the row is checked separately
 * in ExpensesService. Everything downstream of submission is an approver
 * action and excludes `member` (PRD §6.4). This is the table the RBAC e2e test
 * pins down.
 */
export const TRANSITION_ROLES: Record<TransitionAction, readonly Role[]> = {
  submit: ['owner', 'admin', 'member'],
  approve: ['owner', 'admin'],
  reject: ['owner', 'admin'],
  reimburse: ['owner', 'admin'],
  rework: ['owner', 'admin', 'member'],
};

/**
 * Actions that only the expense's own submitter may perform (approvers may
 * perform them on anyone's). ExpensesService does the ownership check; this is
 * the list it consults.
 */
export const OWNER_ONLY_ACTIONS: readonly TransitionAction[] = ['submit', 'rework'];

/** Statuses with nowhere left to go. `reimbursed` is the only true terminal. */
export const TERMINAL_STATUSES: readonly ExpenseStatus[] = (
  Object.keys(EXPENSE_TRANSITIONS) as ExpenseStatus[]
).filter((status) => EXPENSE_TRANSITIONS[status].length === 0);

/**
 * 409 Conflict, not 400 Bad Request.
 *
 * The request is well-formed and the caller is authorised; it is the *current
 * state of the resource* that makes it impossible. That distinction matters to
 * the Copilot: a 400 means "the agent built a bad call and should rephrase", a
 * 409 means "the world moved — re-read the expense". Approving an
 * already-approved expense is the common case, usually a double-click or two
 * approvers racing.
 */
export class IllegalTransitionException extends ConflictException {
  constructor(
    readonly from: ExpenseStatus,
    readonly to: ExpenseStatus,
  ) {
    const allowed = EXPENSE_TRANSITIONS[from];
    super({
      statusCode: 409,
      error: 'Conflict',
      message:
        allowed.length === 0
          ? `An expense that is already ${from} cannot change status.`
          : `Cannot move an expense from ${from} to ${to}. Allowed from ${from}: ${allowed.join(', ')}.`,
      from,
      to,
      allowed,
    });
  }
}

/** Throws `IllegalTransitionException` unless `from -> to` is a legal move. */
export function assertTransition(from: ExpenseStatus, to: ExpenseStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionException(from, to);
  }
}

/** The status an action targets, or undefined if the action is unknown. */
export function targetStatusFor(action: TransitionAction): ExpenseStatus {
  return TRANSITION_ACTIONS[action];
}

/** Whether `role` is permitted to perform `action` at all. */
export function roleMayPerform(role: Role, action: TransitionAction): boolean {
  return TRANSITION_ROLES[action].includes(role);
}
