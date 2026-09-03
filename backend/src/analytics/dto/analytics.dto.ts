import { IsDateString, IsOptional } from 'class-validator';

export class AnalyticsQueryDto {
  /** Both default to the current calendar month. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
