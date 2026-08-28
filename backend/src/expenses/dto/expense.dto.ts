import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EXPENSE_PAGE_MAX } from '@actuo/shared';
import {
  CURRENCIES,
  EXPENSE_STATUSES,
  type CreateExpenseRequest,
  type ExpenseStatus,
  type SearchExpensesQuery,
  type UpdateExpenseRequest,
} from '@actuo/shared';

/**
 * DTOs `implement` the `@actuo/shared` request interfaces so the compiler
 * catches drift between the wire contract and the validated shape. The
 * decorators stay on this side of the boundary: `shared/` ships to the browser
 * and must not pull in class-validator.
 *
 * The enums (`CURRENCIES`, `EXPENSE_STATUSES`) also come from `shared/`, which
 * is where the WebMCP tool JSON Schemas read them from — PRD §9 asks for
 * "input validation matching WebMCP JSON schemas on both client and server",
 * and a single source is the only way that stays true.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** `''` from an HTML form means "not set", not "set to empty string". */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;

export class CreateExpenseDto implements CreateExpenseRequest {
  // maxDecimalPlaces matches numeric(14,2) in the schema, so a value that
  // would be silently rounded by Postgres is rejected here instead.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Amount must be greater than zero.' })
  @Max(99_999_999.99)
  amount!: number;

  @IsIn(CURRENCIES as readonly string[], {
    message: `Currency must be one of: ${CURRENCIES.join(', ')}.`,
  })
  currency!: string;

  @IsOptional()
  @IsUUID('4', { message: 'categoryId must be a UUID.' })
  @Transform(emptyToNull)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(emptyToNull)
  merchant?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(emptyToNull)
  note?: string | null;

  @IsDateString({}, { message: 'expenseDate must be an ISO date (YYYY-MM-DD).' })
  expenseDate!: string;
}

export class UpdateExpenseDto implements UpdateExpenseRequest {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  amount?: number;

  @IsOptional()
  @IsIn(CURRENCIES as readonly string[])
  currency?: string;

  @IsOptional()
  @IsUUID('4')
  @Transform(emptyToNull)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(emptyToNull)
  merchant?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(emptyToNull)
  note?: string | null;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  /**
   * A status change here is routed through the same state machine and the same
   * role check as the dedicated /submit, /approve, /reject, /reimburse routes.
   * PATCH is not a back door around them.
   */
  @IsOptional()
  @IsIn(EXPENSE_STATUSES as readonly string[])
  status?: ExpenseStatus;
}

/** Shared by GET /expenses and GET /expenses/search. */
export class SearchExpensesQueryDto implements SearchExpensesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  query?: string;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsIn(EXPENSE_STATUSES as readonly string[])
  status?: ExpenseStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Query strings are always strings; Type() coerces before the numeric checks
  // run. The cap is 100 (PRD §9: list endpoints paginate) so no single request
  // can ask for an unbounded page.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPENSE_PAGE_MAX)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Body for POST /expenses/:id/approve and /reject. */
export class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(emptyToNull)
  comment?: string | null;
}
