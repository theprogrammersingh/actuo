import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../core/api/api-client.js';
import { ReportDownload } from '../core/reports/report-download.js';
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
  let downloads: { save: ReturnType<typeof vi.fn> };
  let tools: ExpenseTools;

  beforeEach(() => {
    api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    downloads = { save: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ReportDownload, useValue: downloads },
      ],
    });
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

    /**
     * The URL is withheld on purpose. Handing the model a path into an
     * authenticated route is what produced a chat link that 401'd on click; the
     * job id plus a preview is what both the download button and a headless
     * agent can actually use.
     */
    it('returns the job id and a preview, never the download URL', async () => {
      api.post.mockResolvedValue({ jobId: 'job-1' });
      api.get.mockResolvedValue({
        status: 'ready',
        url: '/api/reports/job-1/download',
        rows: 12,
        filename: 'actuo-expenses-2026-08-01_2026-08-28.csv',
        preview: 'date,merchant,amount,currency,status',
        previewTruncated: false,
      });

      const result = await tools.generateReport().execute(
        { from: '2026-08-01', to: '2026-08-28' },
        { signal: new AbortController().signal },
      );

      expect(result).toEqual({
        jobId: 'job-1',
        rows: 12,
        filename: 'actuo-expenses-2026-08-01_2026-08-28.csv',
        preview: 'date,merchant,amount,currency,status',
        previewTruncated: false,
      });
      expect(result).not.toHaveProperty('url');
    });
  });

  describe('download_report', () => {
    const run = (jobId: string) =>
      tools.downloadReport().execute({ jobId }, { signal: new AbortController().signal });

    /**
     * A file lands on the user's machine, so the card must show the amber
     * "changes data" dot. No confirmation: asking to download is the
     * confirmation, and a second click would be friction the user did not ask
     * for.
     */
    it('is annotated as mutating but needs no confirmation', () => {
      const tool = tools.downloadReport();
      expect(tool.contract.annotations.readOnlyHint).toBe(false);
      expect(tool.contract.requiresConfirmation).toBe(false);
    });

    it('saves the job it was given and reports the filename back', async () => {
      downloads.save.mockResolvedValue({ filename: 'actuo-expenses-2026-08-01_2026-08-31.csv' });

      const result = await run('job-1');

      expect(downloads.save).toHaveBeenCalledWith('job-1');
      expect(result).toEqual({
        jobId: 'job-1',
        filename: 'actuo-expenses-2026-08-01_2026-08-31.csv',
      });
    });

    /**
     * Report jobs live in the server's memory. A failure has to reach the model
     * as a failure — answering with a filename for a save that never happened
     * is the one outcome worse than an error.
     */
    it('propagates a failure instead of reporting a save that did not happen', async () => {
      downloads.save.mockRejectedValue(new Error('Report job not found'));

      await expect(run('job-gone')).rejects.toThrow('Report job not found');
    });
  });

  describe('fetch_categories', () => {
    it('is annotated read-only and needs no confirmation', () => {
      const tool = tools.fetchCategories();
      expect(tool.contract.annotations.readOnlyHint).toBe(true);
      expect(tool.contract.requiresConfirmation).toBe(false);
    });

    it('returns categories with id, name, and icon', async () => {
      api.get.mockResolvedValue([
        { id: 'cat-1', orgId: 'org-1', name: 'Travel', icon: 'plane', isDefault: true },
        { id: 'cat-2', orgId: 'org-1', name: 'Meals', icon: 'utensils', isDefault: true },
      ]);

      const result = await tools.fetchCategories().execute(
        {},
        { signal: new AbortController().signal },
      ) as Array<Record<string, unknown>>;

      expect(api.get).toHaveBeenCalledWith(
        '/orgs/current/categories',
        undefined,
        expect.anything(),
      );
      expect(result).toEqual([
        { id: 'cat-1', name: 'Travel', icon: 'plane' },
        { id: 'cat-2', name: 'Meals', icon: 'utensils' },
      ]);
    });
  });

  describe('what it no longer does', () => {
    /**
     * `submit_expense` and `approve_expense` moved to `PageDrivenTools`, which
     * drives the visible page instead of posting behind it. They are absent
     * here on purpose: this service must stay reachable with only an
     * `ApiClient` fake, no router and no DOM.
     */
    it('publishes only the reads and the report tools', () => {
      const names = tools.all().map((tool) => tool.contract.name);
      expect(names).toEqual([
        'search_expenses',
        'get_budget_status',
        'get_spend_summary',
        'generate_report',
        'download_report',
        'fetch_categories',
      ]);
    });

    it('no longer offers the tools that change expenses', () => {
      expect('submitExpense' in tools).toBe(false);
      expect('approveExpense' in tools).toBe(false);
    });
  });
});
