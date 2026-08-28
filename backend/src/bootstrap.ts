import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

export const API_PREFIX = '/api';

/**
 * A fully-initialised Nest app that is deliberately NOT listening yet.
 *
 * Both entry points call this, which is what stops local dev and production
 * from diverging on routing:
 *   main.ts     -> listens on :3000 standalone (dev, behind the Angular proxy)
 *   server.mjs  -> composed with the Angular SSR handler on $PORT (production)
 */
export async function createNestApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
    { logger: ['error', 'warn', 'log'] },
  );

  /*
   * LOAD-BEARING — not cosmetic.
   *
   * Nest's built-in not-found handler is registered via
   * ExpressAdapter.setNotFoundHandler(handler, prefix). With a prefix it is
   * mounted on a router scoped to that prefix; WITHOUT one it becomes a global
   * catch-all that answers every request. In the combined production process
   * that would swallow every Angular route and the SSR fallback would never run.
   *
   * Verified below by an e2e test asserting /api/<unknown> returns JSON while
   * a non-/api path is left for the Angular handler.
   */
  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  await app.init();
  return app;
}
