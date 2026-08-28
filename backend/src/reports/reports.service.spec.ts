import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ExpensesService } from '../expenses/expenses.service.js';
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
const PAGE = { items: Array.from({ length: 40 }, (_, i) => expense(i)), total: 40, limit: 500, offset: 0 };

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
