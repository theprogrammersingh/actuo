import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ReportsController } from './reports.controller.js';
import type { ReportJob, ReportsService } from './reports.service.js';

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};

const READY: ReportJob = {
  id: 'job-1',
  orgId: 'org-1',
  status: 'ready',
  format: 'csv',
  rows: 2,
  url: '/api/reports/job-1/download',
  filename: 'actuo-expenses-2026-08-01_2026-08-31.csv',
  content: 'date,merchant,amount,currency,status\n2026-08-10,Barista,450,INR,approved',
  preview: 'date,merchant,amount,currency,status\n2026-08-10,Barista,450,INR,approved',
  previewTruncated: false,
  createdAt: Date.now(),
};

function createController(job: ReportJob) {
  const reports = { get: vi.fn().mockReturnValue(job) } as unknown as ReportsService;
  const res = { setHeader: vi.fn() } as unknown as Response;
  return { controller: new ReportsController(reports), res };
}

describe('ReportsController', () => {
  it('exposes the preview and filename on the status route', () => {
    const { controller } = createController(READY);

    expect(controller.status(USER, 'job-1')).toEqual({
      jobId: 'job-1',
      status: 'ready',
      rows: 2,
      url: '/api/reports/job-1/download',
      filename: 'actuo-expenses-2026-08-01_2026-08-31.csv',
      preview: READY.preview,
      previewTruncated: false,
      error: undefined,
    });
  });

  /**
   * Without this the CSV renders in the tab instead of saving, which reads as
   * a broken download even when the request itself succeeded.
   */
  it('sends the CSV as an attachment named after the range', () => {
    const { controller, res } = createController(READY);

    const body = controller.download(USER, 'job-1', res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="actuo-expenses-2026-08-01_2026-08-31.csv"',
    );
    expect(body).toBe(READY.content);
  });

  it('falls back to a job-id filename when the job carries none', () => {
    const { controller, res } = createController({ ...READY, filename: undefined });

    controller.download(USER, 'job-1', res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="actuo-report-job-1.csv"',
    );
  });

  it('404s a job that is not ready, and sets no attachment header', () => {
    const { controller, res } = createController({
      ...READY,
      status: 'pending',
      content: undefined,
    });

    expect(() => controller.download(USER, 'job-1', res)).toThrow(NotFoundException);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
