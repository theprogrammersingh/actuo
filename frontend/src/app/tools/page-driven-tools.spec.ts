import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/api/api-client.js';
import { Copilot } from '../copilot/copilot.js';
import { PageActions } from '../webmcp/page-actions.js';
import { PageDrivenTools } from './page-driven-tools.js';

describe('PageDrivenTools', () => {
  let router: { navigateByUrl: ReturnType<typeof vi.fn>; url: string };
  let copilot: { collapseForPageAction: ReturnType<typeof vi.fn> };
  let pages: PageActions;
  let tools: PageDrivenTools;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    router = { navigateByUrl: vi.fn().mockResolvedValue(true), url: '/dashboard' };
    copilot = { collapseForPageAction: vi.fn() };
    api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: Copilot, useValue: copilot },
        { provide: ApiClient, useValue: api },
      ],
    });
    pages = TestBed.inject(PageActions);
    tools = TestBed.inject(PageDrivenTools);
  });

  const signal = () => new AbortController().signal;

  /** A page that answers immediately, as a mounted one would. */
  function mount(action: string, result: unknown = { ok: true }) {
    const handler = vi.fn().mockResolvedValue(result);
    pages.provide(action, handler);
    return handler;
  }

  describe('every write goes through the page that owns it', () => {
    it('opens Add expense and hands it the values', async () => {
      const handler = mount('submit_expense', { id: 'exp-1', status: 'submitted' });

      const result = await tools
        .submitExpense()
        .execute({ amount: 450, currency: 'INR', merchant: 'Barista' }, { signal: signal() });

      expect(router.navigateByUrl).toHaveBeenCalledWith('/add');
      expect(handler).toHaveBeenCalledWith(
        { amount: 450, currency: 'INR', merchant: 'Barista' },
        expect.anything(),
      );
      expect(result).toEqual({ id: 'exp-1', status: 'submitted' });
    });

    it('opens Expenses to decide on a row', async () => {
      const handler = mount('approve_expense');

      await tools
        .approveExpense()
        .execute({ expenseId: 'exp-9', decision: 'approved' }, { signal: signal() });

      expect(router.navigateByUrl).toHaveBeenCalledWith('/expenses');
      expect(handler).toHaveBeenCalledWith(
        { expenseId: 'exp-9', decision: 'approved' },
        expect.anything(),
      );
    });

    it('opens Budgets to change a limit', async () => {
      const handler = mount('set_budget');

      await tools.setBudget().execute({ amount: 20000 }, { signal: signal() });

      expect(router.navigateByUrl).toHaveBeenCalledWith('/budgets');
      expect(handler).toHaveBeenCalledWith({ amount: 20000 }, expect.anything());
    });

    /** The page has to be there before it can be asked to do anything. */
    it('navigates before asking for the handler', async () => {
      const order: string[] = [];
      router.navigateByUrl.mockImplementation(() => {
        order.push('navigate');
        return Promise.resolve(true);
      });
      pages.provide('set_budget', async () => {
        order.push('run');
        return null;
      });

      await tools.setBudget().execute({ amount: 1 }, { signal: signal() });

      expect(order).toEqual(['navigate', 'run']);
    });
  });

  /**
   * LOAD-BEARING. The whole point is that an agent cannot change anything the
   * user is not looking at. If this service could reach `ApiClient` it would be
   * one line away from posting behind the page again.
   */
  it('never touches the API itself', async () => {
    mount('submit_expense');
    mount('approve_expense');
    mount('set_budget');

    await tools.submitExpense().execute({ amount: 1, currency: 'INR' }, { signal: signal() });
    await tools
      .approveExpense()
      .execute({ expenseId: 'e', decision: 'approved' }, { signal: signal() });
    await tools.setBudget().execute({ amount: 1 }, { signal: signal() });

    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
  });

  it('reports a page that never opened, rather than acting invisibly', async () => {
    vi.useFakeTimers();
    try {
      const running = tools.setBudget().execute({ amount: 5 }, { signal: signal() });
      const assertion = expect(running).rejects.toThrow(/did not open in time/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Below `sm` the Copilot is a full-screen sheet, so the page it drives would
   * be hidden behind it — which would defeat driving the page at all.
   */
  it('gets the Copilot out of the way first', async () => {
    mount('submit_expense');

    await tools
      .submitExpense()
      .execute({ amount: 10, currency: 'INR' }, { signal: signal() });

    expect(copilot.collapseForPageAction).toHaveBeenCalled();
  });

  it('publishes the always-on writes, leaving approve to the state gate', () => {
    expect(tools.all().map((tool) => tool.contract.name)).toEqual([
      'submit_expense',
      'set_budget',
    ]);
  });
});
