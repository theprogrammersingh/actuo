import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../api/api-client';
import { saveBlob } from '../download/save-file';

/**
 * Downloads a generated CSV report.
 *
 * The `generate_report` tool used to answer with `/api/reports/<id>/download`,
 * which the model then wrote into chat as a link. That link could never work:
 * the route needs the session bearer header, and a browser navigation carries
 * none, so every click 401'd. The fetch happens here instead, with the token
 * attached, and the file reaches the user through `saveBlob`.
 *
 * It owns the `ApiClient` dependency so neither `ToolRegistry` (which must stay
 * free of HTTP) nor `Copilot` has to grow one.
 */
@Injectable({ providedIn: 'root' })
export class ReportDownload {
  private readonly api = inject(ApiClient);

  private readonly inFlight = signal<string | null>(null);
  /** Kept per job, not as a bare message: several report cards can sit in one
   * conversation, and a failure belongs on the card whose button was pressed. */
  private readonly failure = signal<{ jobId: string; message: string } | null>(null);

  /** The job currently downloading, if any — drives the button's busy state. */
  readonly pendingJobId = this.inFlight.asReadonly();

  isPending(jobId: string | undefined): boolean {
    return jobId !== undefined && this.inFlight() === jobId;
  }

  errorFor(jobId: string | undefined): string | undefined {
    const failure = this.failure();
    return failure && failure.jobId === jobId ? failure.message : undefined;
  }

  /**
   * Fetch and save, or throw. This is the half the `download_report` tool calls.
   *
   * It throws, and it has no in-flight guard, both deliberately: a tool that
   * answers "saved" when nothing was saved lies to the model, and one that
   * never throws leaves it nothing to relay when a job has expired. The button
   * needs the opposite behaviour, which is what `download()` below adds.
   */
  async save(jobId: string): Promise<{ filename: string }> {
    this.inFlight.set(jobId);
    try {
      // Built from the job id, never from the `url` the API reports: that value
      // already carries `/api`, which ApiClient prepends again.
      const { blob, filename } = await this.api.download(`/reports/${jobId}/download`);
      const saveAs = filename ?? `actuo-report-${jobId}.csv`;
      saveBlob(blob, saveAs);
      return { filename: saveAs };
    } finally {
      this.inFlight.set(null);
    }
  }

  /**
   * Never throws: this is called straight from a click handler, and report jobs
   * live in the server's memory, so a restart turns a perfectly good-looking
   * button into a 404. Surfacing that on the card beats an unhandled rejection
   * and a button that silently does nothing.
   */
  async download(jobId: string): Promise<void> {
    if (this.inFlight()) return;

    this.failure.set(null);
    try {
      await this.save(jobId);
    } catch (error) {
      this.failure.set({
        jobId,
        message: error instanceof Error ? error.message : 'The report could not be downloaded.',
      });
    }
  }
}
