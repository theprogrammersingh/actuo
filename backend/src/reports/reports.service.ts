import { Injectable, NotFoundException } from '@nestjs/common';
import { EXPENSE_PAGE_MAX, fetchAllPages } from '@actuo/shared';
import type { Expense } from '@actuo/shared';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import type { GenerateReportDto } from './dto/report.dto.js';

export type ReportStatus = 'pending' | 'ready' | 'failed' | 'cancelled';

export interface ReportJob {
  id: string;
  orgId: string;
  status: ReportStatus;
  format: 'csv' | 'pdf';
  rows?: number;
  url?: string;
  content?: string;
  error?: string;
  createdAt: number;
}

/**
 * Asynchronous report generation (PRD §8.6).
 *
 * This is the server half of the WebMCP cancellation demo: `generate_report` is
 * the tool that must be stoppable mid-flight, so generation is a real job the
 * client polls rather than a single blocking request. Cancelling sets a flag the
 * worker checks between chunks, which is what makes the stop genuine rather than
 * the client merely walking away from a request that keeps running.
 *
 * Jobs live in memory. That is correct for the single-process App Hosting deploy
 * and for a demo; a multi-instance deployment would need shared storage, and the
 * repository seam is where that would go.
 */
@Injectable()
export class ReportsService {
  private readonly jobs = new Map<string, ReportJob>();

  /** Deliberately paced so a human can actually hit Stop during the demo. */
  private readonly chunkDelayMs = Number(process.env.REPORT_CHUNK_DELAY_MS ?? 400);
  private readonly chunkSize = 5;

  constructor(private readonly expenses: ExpensesService) {}

  start(user: AuthenticatedUser, dto: GenerateReportDto): { jobId: string; status: ReportStatus } {
    const job: ReportJob = {
      id: randomId(),
      orgId: user.orgId,
      status: 'pending',
      format: dto.format ?? 'csv',
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);

    // Fire and forget: the client polls `get()`.
    void this.run(job, user, dto);

    return { jobId: job.id, status: job.status };
  }

  get(user: AuthenticatedUser, jobId: string): ReportJob {
    const job = this.jobs.get(jobId);
    // Scope by org so a job id from another tenant is indistinguishable from
    // one that never existed.
    if (!job || job.orgId !== user.orgId) throw new NotFoundException('Report job not found');
    return job;
  }

  cancel(user: AuthenticatedUser, jobId: string): ReportJob {
    const job = this.get(user, jobId);
    if (job.status === 'pending') job.status = 'cancelled';
    return job;
  }

  private async run(
    job: ReportJob,
    user: AuthenticatedUser,
    dto: GenerateReportDto,
  ): Promise<void> {
    try {
      /*
       * Every row, not one page.
       *
       * This previously asked for `limit: 500`. The service clamps to
       * EXPENSE_PAGE_MAX, so the request did not fail — it silently returned
       * the first 100 and produced a CSV that omitted expenses without saying
       * so. For a report that is the worst possible failure: a confident wrong
       * answer. Raising the cap would only move the cliff, so it pages instead.
       *
       * The cancelled check lives in `onPage` as well as in the chunk loop
       * below: without it, Stop would be ignored for the whole fetch of a large
       * range, which is exactly when a user is most likely to press it.
       */
      const { items } = await fetchAllPages<Expense>(
        (offset, limit) =>
          this.expenses.list(user, { from: dto.from, to: dto.to, limit, offset }),
        {
          limit: EXPENSE_PAGE_MAX,
          onPage: () => {
            if (this.jobs.get(job.id)?.status === 'cancelled') {
              throw new ReportCancelled();
            }
          },
        },
      );

      const lines = [CSV_HEADER];

      for (let i = 0; i < items.length; i += this.chunkSize) {
        // The cancellation check has to sit inside the loop; checking once up
        // front would make Stop cosmetic.
        if (this.jobs.get(job.id)?.status === 'cancelled') return;

        for (const expense of items.slice(i, i + this.chunkSize)) {
          lines.push(toCsvRow(expense));
        }
        await delay(this.chunkDelayMs);
      }

      if (this.jobs.get(job.id)?.status === 'cancelled') return;

      job.content = lines.join('\n');
      job.rows = items.length;
      job.url = `/api/reports/${job.id}/download`;
      job.status = 'ready';
    } catch (error) {
      // A cancel mid-fetch is a normal outcome, not a failure.
      if (error instanceof ReportCancelled) return;
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Report generation failed';
    }
  }
}

/** Thrown by the page callback to unwind a cancelled fetch. */
class ReportCancelled extends Error {}

const CSV_HEADER = 'date,merchant,amount,currency,status';

function toCsvRow(expense: Expense): string {
  return [
    expense.expenseDate,
    csvEscape(expense.merchant ?? ''),
    String(expense.amount),
    expense.currency,
    expense.status,
  ].join(',');
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}
