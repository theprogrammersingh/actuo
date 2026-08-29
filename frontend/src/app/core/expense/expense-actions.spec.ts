import type { Expense } from '@actuo/shared';
import { describe, expect, it } from 'vitest';

import {
  ACTION_LABEL,
  ALL_ACTIONS,
  availableActions,
  mayEdit,
  takesComment,
  type ActorContext,
} from './expense-actions.js';

const ME = 'user-me';
const SOMEONE_ELSE = 'user-other';

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    orgId: 'org-1',
    userId: ME,
    categoryId: 'cat-1',
    amount: 100,
    currency: 'INR',
    convertedAmount: 100,
    baseCurrency: 'INR',
    merchant: 'Barista',
    note: null,
    status: 'draft',
    receiptUrl: null,
    expenseDate: '2026-08-10',
    createdAt: '2026-08-10T09:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const owner: ActorContext = { role: 'owner', userId: ME };
const member: ActorContext = { role: 'member', userId: ME };

describe('availableActions', () => {
  it('offers submit on your own draft', () => {
    expect(availableActions(expense({ status: 'draft' }), member)).toEqual(['submit']);
  });

  /**
   * `submit` is owner-only *for a member*. An approver may submit anyone's
   * draft — `ExpensesService.transition` guards it with
   * `OWNER_ONLY_ACTIONS && !isApprover(role) && notYours`, and this mirrors it.
   */
  it('lets an approver submit someone else’s draft', () => {
    expect(availableActions(expense({ status: 'draft', userId: SOMEONE_ELSE }), owner)).toEqual([
      'submit',
    ]);
  });

  it('does not let a member submit someone else’s draft', () => {
    expect(availableActions(expense({ status: 'draft', userId: SOMEONE_ELSE }), member)).toEqual([]);
  });

  /**
   * Segregation of duties, and the reason this file exists rather than a
   * hand-rolled status check: the server refuses a self-decision outright, so
   * offering Approve on your own row would be a button that always 403s.
   */
  it('never offers approve or reject on your own expense, whatever your role', () => {
    expect(availableActions(expense({ status: 'submitted', userId: ME }), owner)).toEqual([]);
  });

  it('still offers them on someone else’s', () => {
    expect(availableActions(expense({ status: 'submitted', userId: SOMEONE_ELSE }), owner)).toEqual([
      'approve',
      'reject',
    ]);
  });

  /** Reimbursing is not a decision, so the self-rule does not apply to it. */
  it('lets an approver reimburse their own approved expense', () => {
    expect(availableActions(expense({ status: 'approved', userId: ME }), owner)).toEqual([
      'reimburse',
    ]);
  });

  it('offers approve and reject on a submitted row to an approver', () => {
    expect(availableActions(expense({ status: 'submitted', userId: SOMEONE_ELSE }), owner)).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('offers nothing on a submitted row to a member', () => {
    expect(availableActions(expense({ status: 'submitted' }), member)).toEqual([]);
  });

  it('offers reimburse once approved, to an approver only', () => {
    expect(availableActions(expense({ status: 'approved', userId: SOMEONE_ELSE }), owner)).toEqual([
      'reimburse',
    ]);
    expect(availableActions(expense({ status: 'approved' }), member)).toEqual([]);
  });

  it('lets the submitter reopen their own rejected row', () => {
    expect(availableActions(expense({ status: 'rejected' }), member)).toEqual(['rework']);
  });

  it('offers nothing on a reimbursed row — it is terminal', () => {
    expect(availableActions(expense({ status: 'reimbursed' }), owner)).toEqual([]);
  });

  it('offers nothing on a soft-deleted row', () => {
    expect(
      availableActions(expense({ status: 'draft', deletedAt: '2026-08-11T00:00:00.000Z' }), owner),
    ).toEqual([]);
  });

  it('offers nothing when the role is not known yet', () => {
    expect(availableActions(expense(), { role: null, userId: ME })).toEqual([]);
  });
});

describe('mayEdit', () => {
  it('is true only for your own draft', () => {
    expect(mayEdit(expense({ status: 'draft' }), member)).toBe(true);
  });

  it('is false once submitted — it is part of an approval record by then', () => {
    expect(mayEdit(expense({ status: 'submitted' }), member)).toBe(false);
  });

  it('is false on someone else’s draft, approver or not', () => {
    expect(mayEdit(expense({ status: 'draft', userId: SOMEONE_ELSE }), owner)).toBe(false);
  });
});

describe('action metadata', () => {
  it('labels every action, so no button can render blank', () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_LABEL[action], action).toBeTruthy();
    }
  });

  /** `approvals.comment` is written by a decision; nothing else stores one. */
  it('takes a comment only on the two decisions', () => {
    expect(takesComment('approve')).toBe(true);
    expect(takesComment('reject')).toBe(true);
    expect(takesComment('submit')).toBe(false);
    expect(takesComment('reimburse')).toBe(false);
    expect(takesComment('rework')).toBe(false);
  });
});
