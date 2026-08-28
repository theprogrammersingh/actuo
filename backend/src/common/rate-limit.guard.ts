import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

export const RATE_LIMIT_KEY = 'actuo:rateLimit';

export interface RateLimitOptions {
  /** Requests allowed per window, per client, per route. */
  limit: number;
  windowMs: number;
}

/** `@RateLimit({ limit: 5, windowMs: 60_000 })` */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiting for the auth endpoints (PRD §9 security).
 *
 * Deliberately a small in-process implementation rather than
 * `@nestjs/throttler`:
 *
 *  - The requirement is narrow — slow down credential stuffing against four
 *    routes — and this is ~60 lines with no new dependency to audit. Dependency
 *    hygiene carries extra weight here because the browser holds the user's
 *    Gemini key (CLAUDE.md rule 6).
 *  - Adding a package would touch the root lockfile, which other agents are
 *    editing concurrently.
 *
 * The honest limitation: state is per-process and in memory. That is correct
 * for the single-process Firebase App Hosting deploy this ships as, and it
 * resets on restart. If this ever runs multiple instances, swap the Map for
 * Redis — the guard's interface would not change.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  /** Only sweep occasionally; the Map is small and sweeping is O(n). */
  private lastSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const now = Date.now();
    this.sweep(now);

    const key = `${context.getClass().name}#${context.getHandler().name}:${clientKey(request)}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests. Try again in ${retryAfter}s.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Identify the client. Behind Firebase App Hosting the socket address is the
 * load balancer's, so prefer the leftmost X-Forwarded-For entry — the original
 * client — falling back to the socket address locally.
 *
 * X-Forwarded-For is spoofable by the client, so this is a speed bump against
 * naive brute force, not an access control. The real defences are argon2's
 * cost and the fact that nothing here leaks whether an email exists.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim();
  return first || request.ip || request.socket?.remoteAddress || 'unknown';
}
