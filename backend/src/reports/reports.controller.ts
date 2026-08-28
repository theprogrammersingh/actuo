import { Body, Controller, Get, Header, NotFoundException, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { GenerateReportDto } from './dto/report.dto.js';
import { ReportsService, type ReportStatus } from './reports.service.js';

interface ReportView {
  jobId: string;
  status: ReportStatus;
  rows?: number;
  url?: string;
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

  @Roles('owner', 'admin', 'member')
  @Get(':id/download')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): string {
    const job = this.reports.get(user, id);
    if (job.status !== 'ready' || job.content === undefined) {
      throw new NotFoundException('Report is not ready');
    }
    return job.content;
  }
}

function view(job: {
  id: string;
  status: ReportStatus;
  rows?: number;
  url?: string;
  error?: string;
}): ReportView {
  return { jobId: job.id, status: job.status, rows: job.rows, url: job.url, error: job.error };
}
