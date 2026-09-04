import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { GenerateReportDto } from './dto/report.dto.js';
import { ReportsService, type ReportJob, type ReportStatus } from './reports.service.js';

interface ReportView {
  jobId: string;
  status: ReportStatus;
  rows?: number;
  url?: string;
  filename?: string;
  preview?: string;
  previewTruncated?: boolean;
  error?: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('owner', 'admin', 'member')
  @Post('generate')
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateReportDto,
  ): { jobId: string; status: ReportStatus } {
    return this.reports.start(user, dto);
  }

  @Roles('owner', 'admin', 'member')
  @Get(':id')
  status(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): ReportView {
    return view(this.reports.get(user, id));
  }

  /** The other half of AbortSignal cancellation: stop the server-side work too. */
  @Roles('owner', 'admin', 'member')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): ReportView {
    return view(this.reports.cancel(user, id));
  }

  /**
   * Authenticated like every other route: the caller sends a bearer header, so
   * this is reached by `ApiClient.download()`, never by navigating the browser
   * to the URL. Content-Disposition is set here rather than with `@Header`
   * because the filename carries the job's own date range.
   */
  @Roles('owner', 'admin', 'member')
  @Get(':id/download')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): string {
    const job = this.reports.get(user, id);
    if (job.status !== 'ready' || job.content === undefined) {
      throw new NotFoundException('Report is not ready');
    }
    const filename = job.filename ?? `actuo-report-${job.id}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return job.content;
  }
}

function view(job: ReportJob): ReportView {
  return {
    jobId: job.id,
    status: job.status,
    rows: job.rows,
    url: job.url,
    filename: job.filename,
    preview: job.preview,
    previewTruncated: job.previewTruncated,
    error: job.error,
  };
}
