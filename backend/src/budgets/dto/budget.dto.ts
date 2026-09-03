import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateBudgetDto {
  /** Omitted or null means the org-wide budget, matching `Budget.categoryId`. */
  @IsOptional()
  @IsUUID('4')
  @Transform(emptyToNull)
  categoryId?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  amount!: number;

  /**
   * Only `monthly` exists in v1 (it is the sole member of `Budget['period']`),
   * but the field is accepted explicitly so adding `quarterly` later is an
   * additive change to this enum rather than a new required field.
   */
  @IsOptional()
  @IsIn(['monthly'])
  period?: 'monthly';

  /** PRD §6.3 rollover vs reset. Stored now, honoured when rollover ships. */
  @IsOptional()
  @IsBoolean()
  rollover?: boolean;
}

export class BudgetStatusQueryDto {
  /** Both default to the current calendar month. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  rollover?: boolean;
}
