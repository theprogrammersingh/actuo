import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../api/api-client';
import { ReportDownload } from './report-download';

describe('ReportDownload', () => {
  let api: { download: ReturnType<typeof vi.fn> };
  let downloads: ReportDownload;
  /** The real `saveBlob` runs; only the click that would open a save dialog is
   * stubbed, so these tests see the filename the user would actually get. */
  let saved: { filename: string | null }[];

  beforeEach(() => {
    api = { download: vi.fn() };
    saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:actuo/report');
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = function () {
      saved.push({ filename: (this as HTMLAnchorElement).getAttribute('download') });
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    downloads = TestBed.inject(ReportDownload);
  });

  /**
   * The `/api` prefix is ApiClient's job. The status route reports a `url` that
   * already carries it, and building the path from that value is how this lands
   * on `/api/api/reports/...`.
   */
  it('builds the path from the job id, not from the reported url', async () => {
    api.download.mockResolvedValue({ blob: new Blob(['x']), filename: 'august.csv' });

    await downloads.download('job-1');

    expect(api.download).toHaveBeenCalledWith('/reports/job-1/download');
  });

  it('saves under the name the server sent', async () => {
    api.download.mockResolvedValue({
      blob: new Blob(['date,merchant']),
      filename: 'actuo-expenses-2026-08-01_2026-08-31.csv',
    });

    await downloads.download('job-1');

    expect(saved).toEqual([{ filename: 'actuo-expenses-2026-08-01_2026-08-31.csv' }]);
  });

  it('falls back to a job-id name when the server named no file', async () => {
    api.download.mockResolvedValue({ blob: new Blob(['x']), filename: null });

    await downloads.download('job-1');

    expect(saved).toEqual([{ filename: 'actuo-report-job-1.csv' }]);
  });

  /**
   * Report jobs live in the server's memory, so a restart 404s a button that
   * still looks fine. This is called straight from a click handler: it has to
   * surface the failure rather than reject into nothing.
   */
  it('reports a failure on the job that failed instead of throwing', async () => {
    api.download.mockRejectedValue(new ApiError('Report job not found', 404, null));

    await expect(downloads.download('job-1')).resolves.toBeUndefined();

    expect(downloads.errorFor('job-1')).toBe('Report job not found');
    expect(downloads.errorFor('job-2')).toBeUndefined();
    expect(saved).toEqual([]);
  });

  it('marks only the job in flight as pending, and clears it when done', async () => {
    let release!: (value: unknown) => void;
    api.download.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const pending = downloads.download('job-1');
    expect(downloads.isPending('job-1')).toBe(true);
    expect(downloads.isPending('job-2')).toBe(false);

    release({ blob: new Blob(['x']), filename: 'a.csv' });
    await pending;

    expect(downloads.isPending('job-1')).toBe(false);
  });

  it('clears a previous failure when a retry starts', async () => {
    api.download.mockRejectedValueOnce(new ApiError('Report job not found', 404, null));
    await downloads.download('job-1');
    expect(downloads.errorFor('job-1')).toBeDefined();

    api.download.mockResolvedValue({ blob: new Blob(['x']), filename: 'a.csv' });
    await downloads.download('job-1');

    expect(downloads.errorFor('job-1')).toBeUndefined();
  });

  /**
   * `save()` is the half the `download_report` tool calls, so it has to behave
   * the opposite way to the button: throw, and never quietly decline.
   */
  describe('save', () => {
    it('returns the name it saved under', async () => {
      api.download.mockResolvedValue({ blob: new Blob(['x']), filename: 'august.csv' });

      await expect(downloads.save('job-1')).resolves.toEqual({ filename: 'august.csv' });
      expect(saved).toEqual([{ filename: 'august.csv' }]);
    });

    it('throws, and records no card-level failure', async () => {
      api.download.mockRejectedValue(new ApiError('Report job not found', 404, null));

      await expect(downloads.save('job-1')).rejects.toThrow('Report job not found');
      expect(downloads.errorFor('job-1')).toBeUndefined();
      expect(downloads.isPending('job-1')).toBe(false);
    });

    /** The button's guard must not silently no-op an agent's request. */
    it('is not blocked by another download already in flight', async () => {
      let release!: (value: unknown) => void;
      api.download.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      const first = downloads.download('job-1');

      api.download.mockResolvedValue({ blob: new Blob(['x']), filename: 'second.csv' });
      await expect(downloads.save('job-2')).resolves.toEqual({ filename: 'second.csv' });

      release({ blob: new Blob(['x']), filename: 'first.csv' });
      await first;
    });
  });
});
