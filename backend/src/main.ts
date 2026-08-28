import { createNestApp } from './bootstrap.js';

const app = await createNestApp();
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
console.log(`[backend] listening on ${await app.getUrl()}`);
