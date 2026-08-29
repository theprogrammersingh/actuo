import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ListAuditQueryDto {
  /**
   * The kind of thing that changed, e.g. `expense`.
   *
   * Free text rather than an enum on purpose: `entity` is written by whichever
   * service made the change, so pinning an enum here would mean this DTO has to
   * be edited every time a new entity starts being audited — and forgetting
   * would silently reject a valid filter.
   */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  entity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
