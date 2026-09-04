import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ExpensesService } from '../expenses/expenses.service.js';
import { EXPENSE_PAGE_MAX } from '@actuo/shared';
import { ReportsService } from './reports.service.js';

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};
const OTHER_ORG: AuthenticatedUser = { ...USER, orgId: 'org-2' };

function expense(i: number) {
  return {
    id: `exp-${i}`,
    expenseDate: '2026-08-10',
    merchant: `Merchant ${i}`,
    amount: 100 + i,
    currency: 'INR',
    status: 'approved',
  };
}

/** Enough rows that generation spans several chunks, so a Stop lands mid-run. */
/** A fake `list` that pages properly, so tests exercise the real loop. */
function pagedList(total: number) {
  return vi.fn(async (_user: unknown, dto: { limit?: number; offset?: number }) => {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;
    return {
      items: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        expense(offset + i),
      ),
      total,
      limit,
      offset,
    };
  });
}

const PAGE = { items: Array.from({ length: 40 }, (_, i) => expense(i)), total: 40, limit: 100, offset: 0 };

function createService(list = vi.fn().mockResolvedValue(PAGE)) {
  const expenses = { list } as unknown as ExpensesService;
  return { service: new ReportsService(expenses), list };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ReportsService', () => {
  beforeEach(() => {
    // Keep the suite fast; the demo default is slower so a human can hit Stop.
    process.env.REPORT_CHUNK_DELAY_MS = '5';
  });

  it('starts a pending job and returns its id', () => {
    const { service } = createService();
    const job = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    expect(job.jobId).toBeTruthy();
    expect(job.status).toBe('pending');
  });

  it('completes and reports the row count and download url', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    const job = service.get(USER, jobId);
    expect(job.rows).toBe(40);
    expect(job.url).toBe(`/api/reports/${jobId}/download`);
    expect(job.content?.split('\n')[0]).toBe('date,merchant,amount,currency,status');
    expect(job.content?.split('\n')).toHaveLength(41); // header + 40 rows
  });

  it('names the file after the range it covers', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    expect(service.get(USER, jobId).filename).toBe('actuo-expenses-2026-08-01_2026-08-31.csv');
  });

  /**
   * The preview is what an agent with no UI gets instead of a download URL it
   * cannot authenticate. Bounded, and it says so when it is bounded — a
   * truncated report presented as a whole one is the same confident wrong
   * answer the paging fix above exists to prevent.
   */
  it('carries a bounded preview that admits when it is truncated', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    const job = service.get(USER, jobId);
    const lines = job.preview?.split('\n') ?? [];
    expect(lines[0]).toBe('date,merchant,amount,currency,status');
    expect(lines).toHaveLength(21); // header + 20 of the 40 rows
    expect(job.previewTruncated).toBe(true);
  });

  it('does not claim truncation when every row fits the preview', async () => {
    const { service } = createService(pagedList(5));
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    const job = service.get(USER, jobId);
    expect(job.previewTruncated).toBe(false);
    expect(job.preview).toBe(job.content);
  });

  /**
   * The point of the whole feature: Stop must actually stop the work, not just
   * detach the client from a job that keeps running to completion.
   */
  it('abandons generation mid-run when cancelled, leaving no content', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await settle();
    service.cancel(USER, jobId);

    // Give it well past the time a full run would have needed.
    await new Promise((resolve) => setTimeout(resolve, 120));

    const job = service.get(USER, jobId);
    expect(job.status).toBe('cancelled');
    expect(job.content).toBeUndefined();
    expect(job.rows).toBeUndefined();
  });

  it('does not resurrect a cancelled job', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });
    await settle();
    service.cancel(USER, jobId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(service.get(USER, jobId).status).toBe('cancelled');
  });

  it('cancelling a finished job leaves it ready', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });
    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    expect(service.cancel(USER, jobId).status).toBe('ready');
  });

  it('marks the job failed when the underlying query throws', async () => {
    const { service } = createService(vi.fn().mockRejectedValue(new Error('db is down')));
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('failed'), { timeout: 5000 });
    expect(service.get(USER, jobId).error).toBe('db is down');
  });

  // Tenancy: another org's job id must look like it never existed.
  it('hides jobs belonging to another organization', async () => {
    const { service } = createService();
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });

    expect(() => service.get(OTHER_ORG, jobId)).toThrow(NotFoundException);
    expect(() => service.get(USER, 'no-such-job')).toThrow(NotFoundException);
  });

  it('escapes commas and quotes in merchant names', async () => {
    const { service } = createService(
      vi.fn().mockResolvedValue({
        items: [{ ...expense(1), merchant: 'Cafe "Bloom", Delhi' }],
        total: 1,
        limit: 500,
        offset: 0,
      }),
    );
    const { jobId } = service.start(USER, { from: '2026-08-01', to: '2026-08-31' });
    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 5000 });

    expect(service.get(USER, jobId).content).toContain('"Cafe ""Bloom"", Delhi"');
  });
});

/**
 * The regression that mattered and nothing covered.
 *
 * Report generation used to ask for `limit: 500`. The service clamps to
 * EXPENSE_PAGE_MAX, so the request did not fail — it returned the first 100
 * rows and produced a CSV that silently omitted the rest. For a financial
 * report that is a confident wrong answer, which is worse than an error.
 */
describe('ReportsService completeness across pages', () => {
  beforeEach(() => {
    process.env.REPORT_CHUNK_DELAY_MS = '1';
  });

  it('includes every row when the range exceeds one page', async () => {
    const list = pagedList(250);
    const service = new ReportsService({ list } as unknown as ExpensesService);
    const { jobId } = service.start(USER, { from: '2026-01-01', to: '2026-12-31' });

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 15000 });

    const job = service.get(USER, jobId);
    expect(job.rows).toBe(250);
    // header + every row
    expect(job.content?.trim().split('\n')).toHaveLength(251);
    // It really paged rather than asking for one oversized page.
    expect(list.mock.calls.length).toBeGreaterThan(1);
  });

  it('never requests more than the API allows', async () => {
    const list = pagedList(250);
    const service = new ReportsService({ list } as unknown as ExpensesService);
    const { jobId } = service.start(USER, { from: '2026-01-01', to: '2026-12-31' });
    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('ready'), { timeout: 15000 });

    for (const [, dto] of list.mock.calls) {
      expect((dto as { limit: number }).limit).toBeLessThanOrEqual(EXPENSE_PAGE_MAX);
    }
  });

  /**
   * Deterministic rather than timing-based: the fake cancels the job itself
   * once two pages are in, so the assertion does not depend on a sleep winning
   * a race against instantly-resolving promises.
   */
  it('stops fetching when cancelled mid-pagination', async () => {
    let service!: ReportsService;
    let jobId = '';

    const inner = pagedList(5000);
    const list = vi.fn(async (user: unknown, dto: { limit?: number; offset?: number }) => {
      const page = await inner(user, dto);
      if (list.mock.calls.length >= 2 && jobId) service.cancel(USER, jobId);
      return page;
    });

    service = new ReportsService({ list } as unknown as ExpensesService);
    jobId = service.start(USER, { from: '2026-01-01', to: '2026-12-31' }).jobId;

    await vi.waitFor(() => expect(service.get(USER, jobId).status).toBe('cancelled'), {
      timeout: 5000,
    });

    const job = service.get(USER, jobId);
    expect(job.content).toBeUndefined();
    expect(job.rows).toBeUndefined();
    // Abandoned after the cancel, not after draining all 50 pages.
    expect(list.mock.calls.length).toBeLessThan(10);
  });
});
