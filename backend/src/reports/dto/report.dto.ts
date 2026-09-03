import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class GenerateReportDto {
  @IsISO8601({ strict: true }, { message: 'from must be a date in YYYY-MM-DD form' })
  from!: string;

  @IsISO8601({ strict: true }, { message: 'to must be a date in YYYY-MM-DD form' })
  to!: string;

  /** CSV only — `pdf` was accepted here and then ignored by the service. */
  @IsOptional()
  @IsIn(['csv'], { message: 'format must be csv — PDF export is not implemented' })
  format?: 'csv';
}
