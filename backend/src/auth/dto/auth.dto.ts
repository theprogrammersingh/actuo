import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { LoginRequest, SignupRequest } from '@actuo/shared';

/**
 * Validation lives here, in `backend/`, not in `@actuo/shared`.
 *
 * `shared/` is compiled into the browser bundle and must stay decorator-free:
 * adding class-validator there would drag its runtime (and `reflect-metadata`)
 * into the client. So each DTO `implements` the shared interface — TypeScript
 * then fails the build if the wire contract and the validated shape ever drift.
 */
export class SignupDto implements SignupRequest {
  @IsEmail({}, { message: 'A valid email address is required.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(320)
  email!: string;

  // 12 chars minimum with no composition rules: length beats character-class
  // theatre, and argon2 handles the rest.
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters.' })
  @MaxLength(200)
  password!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 120)
  name!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 120)
  orgName!: string;
}

export class LoginDto implements LoginRequest {
  @IsEmail({}, { message: 'A valid email address is required.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @Length(1, 4096)
  refreshToken!: string;
}
