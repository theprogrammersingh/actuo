import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class AppendToolCallDto {
  /**
   * Who initiated it. Recorded as claimed by the client, because there is no
   * server-side way to distinguish "the user clicked a button" from "the
   * Copilot called the tool" — both arrive as the same authenticated request.
   * This field is an analytics/demo label, never an authorisation input:
   * `actor: 'agent'` grants nothing that `actor: 'human'` does not.
   */
  @IsIn(['human', 'agent'])
  actor!: 'human' | 'agent';

  @IsString()
  @Length(1, 120)
  toolName!: string;

  /**
   * Free-form JSON, stored in a jsonb column. Deliberately unvalidated beyond
   * being present: this is a log of what a tool was *actually* called with,
   * including malformed calls from an agent. Constraining it would throw away
   * exactly the failures worth reviewing.
   *
   * `@IsOptional()` rather than `@Allow()` because the global ValidationPipe
   * runs with `forbidNonWhitelisted`, which strips any property carrying no
   * decorator at all.
   */
  @IsOptional()
  input?: unknown;

  @IsOptional()
  output?: unknown;
}

export class ListToolCallsQueryDto {
  @IsOptional()
  @IsIn(['human', 'agent'])
  actor?: 'human' | 'agent';

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
