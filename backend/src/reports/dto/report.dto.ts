import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class GenerateReportDto {
  @IsISO8601({ strict: true }, { message: 'from must be a date in YYYY-MM-DD form' })
  from!: string;

  @IsISO8601({ strict: true }, { message: 'to must be a date in YYYY-MM-DD form' })
  to!: string;

  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: 'csv' | 'pdf';
}
