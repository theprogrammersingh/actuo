import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/api/api-client.js';
import { ExpenseTools } from './expense-tools.js';

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    amount: 450,
    currency: 'INR',
    merchant: 'Barista',
    status: 'submitted',
    expenseDate: '2026-08-27',
    ...overrides,
  };
}

describe('ExpenseTools', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let tools: ExpenseTools;

  beforeEach(() => {
    api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    tools = TestBed.inject(ExpenseTools);
  });

  describe('search_expenses', () => {
    it('is annotated read-only so agents can call it without confirmation', () => {
      const tool = tools.searchExpenses();
      expect(tool.contract.annotations.readOnlyHint).toBe(true);
      expect(tool.contract.requiresConfirmation).toBe(false);
    });

    it('summarizes results rather than returning full rows', async () => {
      api.get.mockResolvedValue({ total: 1, items: [expense({ note: 'long note' })] });

      const result = (await tools.searchExpenses().execute(
        { query: 'coffee' },
        { signal: new AbortController().signal },
      )) as { total: number; expenses: Record<string, unknown>[] };

      expect(api.get).toHaveBeenCalledWith('/expenses/search', { query: 'coffee' }, expect.anything());
      expect(result.total).toBe(1);
      // The summary goes back to the model; extra fields would waste context.
      expect(result.expenses[0]).not.toHaveProperty('note');
      expect(result.expenses[0]).toMatchObject({ merchant: 'Barista', amount: 450 });
    });
  });

  describe('submit_expense', () => {
    it('is flagged as requiring confirmation, since it moves money', () => {
      const tool = tools.submitExpense();
      expect(tool.contract.requiresConfirmation).toBe(true);
      expect(tool.contract.annotations.readOnlyHint).toBe(false);
    });

    it('creates then submits, and defaults the date to today', async () => {
      api.post
        .mockResolvedValueOnce(expense({ status: 'draft' }))
        .mockResolvedValueOnce(expense({ status: 'submitted' }));

      const result = await tools.submitExpense().execute(
        { amount: 450, currency: 'INR', merchant: 'Barista' },
        { signal: new AbortController().signal },
      );

      const [, createBody] = api.post.mock.calls[0];
      expect(createBody.expenseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(api.post.mock.calls[1][0]).toBe('/expenses/exp-1/submit');
      expect(result).toMatchObject({ status: 'submitted' });
    });
  });

  describe('get_budget_status', () => {
    it('formats utilization and flags overspend', async () => {
      api.get.mockResolvedValue([
        { categoryName: 'Travel', budgeted: 1000, spent: 1250, remaining: -250, utilization: 1.25 },
      ]);

      const result = (await tools.getBudgetStatus().execute(
        {},
        { signal: new AbortController().signal },
      )) as Array<Record<string, unknown>>;

      expect(result[0]).toMatchObject({ category: 'Travel', utilization: '125%', overBudget: true });
    });

    it('includes atWarningThreshold for categories nearing budget', async () => {
      api.get.mockResolvedValue([
        {
          categoryId: 'cat-1',
          categoryName: 'Travel',
          budgeted: 10000,
          declaredBudget: 10000,
          carryforward: 0,
          spent: 8500,
          remaining: 1500,
          utilization: 0.85,
          currency: 'INR',
          unconvertedCount: 0,
        },
      ]);

      const result = (await tools.getBudgetStatus().execute(
        {},
        { signal: new AbortController().signal },
      )) as Array<Record<string, unknown>>;

      expect(result[0]).toMatchObject({
        category: 'Travel',
        utilization: '85%',
        atWarningThreshold: true,
        overBudget: false,
      });
    });
  });

  describe('get_spend_summary', () => {
    it('calls /analytics/summary and reshapes for the model', async () => {
      api.get.mockResolvedValue({
        month: '2026-08',
        currency: 'INR',
        monthSpend: 25000,
        previousMonthSpend: 20000,
        monthOverMonthDelta: 25,
        byCategory: [
          { categoryId: 'cat-1', categoryName: 'Travel', spent: 15000, share: 0.6 },
          { categoryId: 'cat-2', categoryName: 'Meals', spent: 10000, share: 0.4 },
        ],
        unconvertedCount: 0,
        draftCount: 2,
      });

      const result = (await tools.getSpendSummary().execute(
        {},
        { signal: new AbortController().signal },
      )) as Record<string, unknown>;

      expect(api.get).toHaveBeenCalledWith('/analytics/summary', undefined, expect.any(AbortSignal));
      expect(result).toMatchObject({
        month: '2026-08',
        currency: 'INR',
        monthSpend: 25000,
        monthOverMonthDelta: '+25%',
        byCategory: [
          { category: 'Travel', spent: 15000, share: '60%' },
          { category: 'Meals', spent: 10000, share: '40%' },
        ],
      });
    });

    it('shows N/A for MoM delta when there is no prior data', async () => {
      api.get.mockResolvedValue({
        month: '2026-08',
        currency: 'INR',
        monthSpend: 5000,
        previousMonthSpend: 0,
        monthOverMonthDelta: null,
        byCategory: [],
        unconvertedCount: 0,
        draftCount: 0,
      });

      const result = (await tools.getSpendSummary().execute(
        {},
        { signal: new AbortController().signal },
      )) as Record<string, unknown>;

      expect(result['monthOverMonthDelta']).toBe('N/A (no prior data)');
    });
  });

  describe('generate_report (cancellation)', () => {
    it('stops polling and reports cancellation when aborted mid-flight', async () => {
      const controller = new AbortController();
      api.post.mockResolvedValue({ jobId: 'job-1' });
      // Never becomes ready, so only an abort ends this.
      api.get.mockResolvedValue({ status: 'pending' });

      const pending = tools.generateReport().execute(
        { from: '2026-08-01', to: '2026-08-28' },
        { signal: controller.signal },
      );

      // Let the first poll happen, then cancel.
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();

      await expect(pending).rejects.toThrow('Report generation cancelled.');
    });

    it('tells the server to stop, so cancellation is not merely local', async () => {
      const controller = new AbortController();
      api.post.mockResolvedValue({ jobId: 'job-1' });
      api.get.mockResolvedValue({ status: 'pending' });

      const pending = tools.generateReport().execute(
        { from: '2026-08-01', to: '2026-08-28' },
        { signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await expect(pending).rejects.toThrow();

      expect(api.post).toHaveBeenCalledWith('/reports/job-1/cancel');
    });

    it('returns the report location once the job is ready', async () => {
      api.post.mockResolvedValue({ jobId: 'job-1' });
      api.get.mockResolvedValue({ status: 'ready', url: '/reports/job-1.csv', rows: 12 });

      const result = await tools.generateReport().execute(
        { from: '2026-08-01', to: '2026-08-28' },
        { signal: new AbortController().signal },
      );

      expect(result).toEqual({ url: '/reports/job-1.csv', rows: 12 });
    });
  });

  describe('approve_expense', () => {
    it('routes to approve or reject based on the decision', async () => {
      api.post.mockResolvedValue(expense({ status: 'approved' }));

      await tools.approveExpense().execute(
        { expenseId: 'exp-9', decision: 'approved' },
        { signal: new AbortController().signal },
      );
      expect(api.post.mock.calls[0][0]).toBe('/expenses/exp-9/approve');

      api.post.mockResolvedValue(expense({ status: 'rejected' }));
      await tools.approveExpense().execute(
        { expenseId: 'exp-9', decision: 'rejected', comment: 'no receipt' },
        { signal: new AbortController().signal },
      );
      expect(api.post.mock.calls[1][0]).toBe('/expenses/exp-9/reject');
      expect(api.post.mock.calls[1][1]).toEqual({ comment: 'no receipt' });
    });

    it('is not in the always-on set, because it is state-gated', () => {
      const names = tools.all().map((tool) => tool.contract.name);
      expect(names).not.toContain('approve_expense');
      expect(names).toEqual([
        'search_expenses',
        'submit_expense',
        'get_budget_status',
        'get_spend_summary',
        'generate_report',
      ]);
    });
  });
});
