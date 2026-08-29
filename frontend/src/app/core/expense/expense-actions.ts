import {
  TRANSITION_ACTIONS,
  canTransition,
  mayPerformOn,
  targetStatusFor,
  type Expense,
  type Role,
  type TransitionAction,
} from '@actuo/shared';

/**
 * Which workflow actions to offer on a given expense row.
 *
 * This mirrors the three checks `ExpensesService.transition` makes, in the same
 * order, against the same tables from `@actuo/shared`. It is a **UX** rule, not
 * a security one: the server re-checks all three on every call, and a member who
 * hand-crafts an approve request still gets a 403. What this buys is not
 * offering a button that is guaranteed to fail.
 *
 * Keeping it as plain functions over plain data — no injector, no signals —
 * means the rules can be unit-tested directly rather than through a rendered
 * table, which is how the equivalent backend table is tested too.
 */

/** Every action, in the order they should appear on a row. */
const ACTION_ORDER: readonly TransitionAction[] = [
  'submit',
  'approve',
  'reject',
  'reimburse',
  'rework',
];

export interface ActorContext {
  role: Role | null;
  userId: string | null;
}

/**
 * The actions `actor` may perform on `expense` right now.
 *
 * Two questions, both answered by `@actuo/shared`:
 *  1. is the move legal from this status (`canTransition`), and
 *  2. may this actor make it on this particular row (`mayPerformOn`) — which
 *     folds together role, the owner-only actions, and the segregation-of-duties
 *     rule that nobody decides on their own expense.
 *
 * `ExpensesService.transition` calls the same `mayPerformOn`, so the buttons and
 * the guard cannot drift. A soft-deleted row offers nothing: the server refuses
 * every transition on it.
 */
export function availableActions(expense: Expense, actor: ActorContext): TransitionAction[] {
  const { role, userId } = actor;
  if (!role || expense.deletedAt !== null) return [];

  return ACTION_ORDER.filter(
    (action) =>
      canTransition(expense.status, targetStatusFor(action)) &&
      mayPerformOn(role, action, expense.userId, userId),
  );
}

/** Whether the actor may edit or delete this row at all. */
export function mayEdit(expense: Expense, actor: ActorContext): boolean {
  if (!actor.role || expense.deletedAt !== null) return false;
  // Only a draft is still the submitter's to change; once submitted it is part
  // of an approval record. Approvers do not get an edit button either — moving
  // it through the workflow is the approver's lever, not rewriting the amount.
  return expense.status === 'draft' && expense.userId === actor.userId;
}

/** The button label for an action. */
export const ACTION_LABEL: Readonly<Record<TransitionAction, string>> = {
  submit: 'Submit',
  approve: 'Approve',
  reject: 'Reject',
  reimburse: 'Mark reimbursed',
  rework: 'Reopen',
};

/**
 * Which actions take an optional comment.
 *
 * Only the two that record a decision: `approvals.comment` is written by
 * approve and reject, and nothing else has anywhere to put one.
 */
export const ACTIONS_WITH_COMMENT: readonly TransitionAction[] = ['approve', 'reject'];

export function takesComment(action: TransitionAction): boolean {
  return ACTIONS_WITH_COMMENT.includes(action);
}

/** `approve` -> `/expenses/:id/approve`. Named separately so a rename is caught. */
export function actionPath(id: string, action: TransitionAction): string {
  return `/expenses/${id}/${action}`;
}

/** Present tense, for the confirmation and error copy. */
export function describeAction(action: TransitionAction): string {
  return ACTION_LABEL[action].toLowerCase();
}

/** Exported so a caller can assert it covers every action in the union. */
export const ALL_ACTIONS = Object.keys(TRANSITION_ACTIONS) as TransitionAction[];
