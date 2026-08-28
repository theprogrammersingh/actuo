import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthSession } from '@actuo/shared';
import { RateLimit } from '../common/rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, SignupDto } from './dto/auth.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';

/**
 * PRD §6.1 / §8.6.
 *
 * Every route here is rate-limited (PRD §9). The windows are tight on the
 * credential-checking routes and looser on refresh, which a legitimate client
 * hits on a schedule.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ limit: 5, windowMs: 15 * 60_000 })
  @Post('signup')
  signup(
    @Body() dto: SignupDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSession> {
    return this.auth.signup({ ...dto, userAgent: userAgent ?? null });
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: 15 * 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string): Promise<AuthSession> {
    return this.auth.login({ ...dto, userAgent: userAgent ?? null });
  }

  @Public()
  @RateLimit({ limit: 60, windowMs: 15 * 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(
    @Body() dto: RefreshDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSession> {
    return this.auth.refresh(dto.refreshToken, userAgent ?? null);
  }

  /**
   * Public because a client whose access token has already expired must still
   * be able to end its session — requiring a valid access token here would
   * strand exactly the sessions most in need of revoking. The refresh token in
   * the body is the credential.
   */
  @Public()
  @RateLimit({ limit: 30, windowMs: 15 * 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() dto: RefreshDto): Promise<{ revoked: boolean }> {
    return this.auth.logout(dto.refreshToken);
  }

  /** Who am I, according to the server. Handy for debugging a stale token. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
