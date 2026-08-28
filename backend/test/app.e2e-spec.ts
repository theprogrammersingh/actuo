import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createNestApp } from '../src/bootstrap.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createNestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  // Every route lives under the /api prefix so the Angular SSR handler can own
  // the rest of the URL space in the combined deploy.
  it('/api (GET)', () => {
    return request(app.getHttpServer()).get('/api').expect(200).expect('Hello World!');
  });
});
