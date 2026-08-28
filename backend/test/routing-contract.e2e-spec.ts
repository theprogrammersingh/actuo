import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../src/bootstrap.js';

/**
 * The routing contract that makes the combined Firebase App Hosting deploy work.
 *
 * In production a single Node process serves both: Nest owns `/api/*` and the
 * Angular SSR handler is appended after it to catch everything else. Two things
 * must hold, and both are easy to break with a one-line change:
 *
 *  1. Nest answers unknown `/api/*` routes itself, with JSON. If it instead let
 *     them fall through, the Angular app shell would be returned for a bad API
 *     call — a 200-shaped HTML response where JSON was expected.
 *
 *  2. Nest must NOT answer non-`/api` routes, or its catch-all would swallow
 *     every Angular route and SSR would never run.
 *
 * Both depend on `setGlobalPrefix(API_PREFIX)` receiving a prefix WITH a leading
 * slash. Nest's route mapping normalizes 'api' -> '/api', but the not-found
 * router is mounted verbatim via `express.use(prefix, router)`, and Express
 * never matches a mount path lacking the slash. With 'api' the scoped 404
 * router silently does nothing and Express's default HTML finalhandler answers.
 */
describe('routing contract (api prefix vs SSR fallback)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createNestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves a known /api route', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('answers unknown /api routes with JSON, not the app shell', async () => {
    const res = await request(app.getHttpServer()).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.statusCode).toBe(404);
  });

  it('does not claim non-/api routes, leaving them for the SSR handler', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard');
    // Standalone there is nothing behind Nest, so this 404s — but it must not be
    // Nest's JSON 404, which would mean a catch-all is installed and Angular
    // would never see the request in the composed process.
    expect(res.headers['content-type'] ?? '').not.toMatch(/application\/json/);
  });
});
