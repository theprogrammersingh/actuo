import { ConflictException } from '@nestjs/common';
import {
  EXPENSE_TRANSITIONS,
  canTransition,
  type ExpenseStatus,
} from '@actuo/shared';

/**
 * The approval workflow, PRD §6.4:
 *
 *   draft -> submitted -> approved -> reimbursed
 *                      \-> rejected -> draft
 *
 * The *shape* of the workflow lives in `@actuo/shared` — which transitions are
 * legal (`canTransition`, `EXPENSE_TRANSITIONS`), what each action is called and
 * where it leads (`TRANSITION_ACTIONS`, `targetStatusFor`), who may perform it
 * (`TRANSITION_ROLES`, `roleMayPerform`), and which actions are restricted to
 * the row's own submitter (`OWNER_ONLY_ACTIONS`). All of it is shared because
 * the UI has to offer exactly the actions the server will accept, and the
 * frontend cannot import from `backend/`.
 *
 * What is left here is the part that is genuinely server-only: which HTTP
 * failure an illegal move produces. The server is the only enforcer; the UI
 * merely reflects it.
 *
 * Re-exported below so existing importers of this module keep working and there
 * is one obvious place to look from the backend side.
 */
export {
  APPROVER_ROLES,
  EXPENSE_TRANSITIONS,
  NOT_ON_OWN_ACTIONS,
  OWNER_ONLY_ACTIONS,
  TERMINAL_STATUSES,
  TRANSITION_ACTIONS,
  TRANSITION_ROLES,
  canTransition,
  isApprover,
  mayPerformOn,
  roleMayPerform,
  targetStatusFor,
} from '@actuo/shared';
export type { TransitionAction } from '@actuo/shared';

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
