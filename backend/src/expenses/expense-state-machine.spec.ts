import { describe, expect, it } from 'vitest';
import { EXPENSE_TRANSITIONS, canTransition, type ExpenseStatus, type Role } from '@actuo/shared';
import {
  IllegalTransitionException,
  TERMINAL_STATUSES,
  TRANSITION_ACTIONS,
  assertTransition,
  roleMayPerform,
  targetStatusFor,
  type TransitionAction,
} from './expense-state-machine.js';

const ALL_STATUSES = Object.keys(EXPENSE_TRANSITIONS) as ExpenseStatus[];

/**
 * Every ordered pair of statuses, split by whether the shared transition table
 * says it is legal. Deriving both sets from the table rather than listing them
 * by hand means adding a status to `@actuo/shared` automatically widens this
 * suite instead of silently leaving the new state untested.
 */
const ALL_PAIRS = ALL_STATUSES.flatMap((from) => ALL_STATUSES.map((to) => ({ from, to })));
const LEGAL_PAIRS = ALL_PAIRS.filter(({ from, to }) => canTransition(from, to));
const ILLEGAL_PAIRS = ALL_PAIRS.filter(({ from, to }) => !canTransition(from, to));

describe('expense state machine', () => {
  it('covers the PRD §6.4 workflow exactly', () => {
    // Pins the shape of the machine itself. If someone adds a shortcut such as
    // draft -> approved, this fails before any of the per-pair tests do, and
    // says why.
    expect(EXPENSE_TRANSITIONS).toEqual({
      draft: ['submitted'],
      submitted: ['approved', 'rejected'],
      approved: ['reimbursed'],
      rejected: ['draft'],
      reimbursed: [],
    });
  });

  it('enumerates 5 legal and 20 illegal ordered pairs', () => {
    // 5 statuses -> 25 ordered pairs. A guard against the derivation above
    // silently collapsing to an empty set and every loop below vacuously passing.
    expect(ALL_PAIRS).toHaveLength(25);
    expect(LEGAL_PAIRS).toHaveLength(5);
    expect(ILLEGAL_PAIRS).toHaveLength(20);
  });

  describe('legal transitions are allowed', () => {
    it.each(LEGAL_PAIRS)('$from -> $to', ({ from, to }) => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });
  });

  describe('every illegal transition is rejected with 409', () => {
    it.each(ILLEGAL_PAIRS)('$from -> $to', ({ from, to }) => {
      expect(() => assertTransition(from, to)).toThrow(IllegalTransitionException);

      let thrown: IllegalTransitionException | undefined;
      try {
        assertTransition(from, to);
      } catch (error) {
        thrown = error as IllegalTransitionException;
      }

      // 409 Conflict, not 400: the request is valid, the resource's state is
      // what makes it impossible.
      expect(thrown?.getStatus()).toBe(409);

      const body = thrown?.getResponse() as Record<string, unknown>;
      expect(body.from).toBe(from);
      expect(body.to).toBe(to);
      // The error names what *is* possible, so the Copilot can recover without
      // a second round trip.
      expect(body.allowed).toEqual(EXPENSE_TRANSITIONS[from]);
      expect(String(body.message)).toContain(from);
    });
  });

  it('rejects self-transitions — re-approving an approved expense is a conflict', () => {
    for (const status of ALL_STATUSES) {
      expect(() => assertTransition(status, status)).toThrow(IllegalTransitionException);
    }
  });

  it('rejects every backwards move out of a terminal state', () => {
    expect(TERMINAL_STATUSES).toEqual(['reimbursed']);
    for (const to of ALL_STATUSES) {
      expect(() => assertTransition('reimbursed', to)).toThrow(IllegalTransitionException);
    }
  });

  it('lets a rejected expense be reworked, but only back to draft', () => {
    expect(() => assertTransition('rejected', 'draft')).not.toThrow();
    expect(() => assertTransition('rejected', 'submitted')).toThrow(IllegalTransitionException);
    expect(() => assertTransition('rejected', 'approved')).toThrow(IllegalTransitionException);
  });

  it('does not allow approval to skip submission', () => {
    expect(() => assertTransition('draft', 'approved')).toThrow(IllegalTransitionException);
    expect(() => assertTransition('draft', 'rejected')).toThrow(IllegalTransitionException);
    expect(() => assertTransition('draft', 'reimbursed')).toThrow(IllegalTransitionException);
  });

  it('does not allow reimbursement without approval', () => {
    expect(() => assertTransition('submitted', 'reimbursed')).toThrow(IllegalTransitionException);
    expect(() => assertTransition('rejected', 'reimbursed')).toThrow(IllegalTransitionException);
    expect(() => assertTransition('approved', 'reimbursed')).not.toThrow();
  });
});

describe('transition actions', () => {
  it('maps each action to its target status', () => {
    expect(targetStatusFor('submit')).toBe('submitted');
    expect(targetStatusFor('approve')).toBe('approved');
    expect(targetStatusFor('reject')).toBe('rejected');
    expect(targetStatusFor('reimburse')).toBe('reimbursed');
  });

  it('reaches every non-draft status through some action', () => {
    // draft is only ever an initial or reworked state, never an action target.
    const reachable = new Set(Object.values(TRANSITION_ACTIONS));
    for (const status of ALL_STATUSES) {
      if (status === 'draft') continue;
      expect(reachable.has(status as never)).toBe(true);
    }
  });
});

describe('transition RBAC (PRD §6.4)', () => {
  const roles: Role[] = ['owner', 'admin', 'member'];
  const approverActions: TransitionAction[] = ['approve', 'reject', 'reimburse'];

  it('lets every role submit — ownership of the row is the separate check', () => {
    for (const role of roles) {
      expect(roleMayPerform(role, 'submit')).toBe(true);
    }
  });

  it('never lets a member approve, reject or reimburse', () => {
    for (const action of approverActions) {
      expect(roleMayPerform('member', action)).toBe(false);
    }
  });

  it('lets owners and admins perform every approver action', () => {
    for (const action of approverActions) {
      expect(roleMayPerform('owner', action)).toBe(true);
      expect(roleMayPerform('admin', action)).toBe(true);
    }
  });
});
