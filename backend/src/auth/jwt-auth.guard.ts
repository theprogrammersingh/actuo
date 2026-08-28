import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { EnvService, MissingEnvError } from '../config/env.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types.js';

/**
 * Verifies the `Authorization: Bearer <access token>` header and attaches the
 * caller to `req.user`.
 *
 * Registered globally (see AppModule), so every route is authenticated unless
 * it carries `@Public()`. Failing closed is the point: a new controller added
 * six weeks from now is protected by default.
 *
 * The signing secret is fetched at *verify* time, not at construction. That is
 * what lets the app boot — and the routing-contract e2e test run — against the
 * blank `.env` this repo ships with.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token.');

    let secret: string;
    try {
      secret = this.env.requireAccessSecret();
    } catch (error) {
      if (error instanceof MissingEnvError) {
        // Misconfigured server, but the caller must not learn that from a 200.
        // 401 keeps the failure closed; the reason is in the server log.
        throw new UnauthorizedException('Authentication is not configured on this server.');
      }
      throw error;
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    // A refresh token is signed with a different secret and so cannot verify
    // here, but check `typ` anyway: if the two secrets are ever set to the same
    // value by accident, this is the line that stops a refresh token from
    // being accepted as an access token.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Wrong token type.');
    }

    const user: AuthenticatedUser = {
      userId: payload.sub,
      email: payload.email,
      orgId: payload.org,
      // NOTE: no role here. Roles come from the database in RolesGuard.
    };
    (request as Request & { user?: AuthenticatedUser }).user = user;
    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
