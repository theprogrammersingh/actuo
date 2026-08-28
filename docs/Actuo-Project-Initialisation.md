# Actuo — Project Initialization Guide

**Companion to:** Actuo-PRD.md, Actuo-Design-Doc.md
**Purpose:** Step-by-step setup for developers spinning up the monorepo for the first time.
**Last updated:** August 28, 2026

---

## 1. Prerequisites

```bash
node -v        # Node 20 LTS recommended (Firebase App Hosting runs on Node 20)
npm -v
```

Install/confirm these CLIs globally:
```bash
npm install -g @angular/cli firebase-tools
```

Accounts/keys to have ready before starting:
- A **Firebase project** (console.firebase.google.com)
- A **Supabase project** (supabase.com) — grab the Project URL and `service_role` key from Settings → API
- A personal **Gemini API key** from Google AI Studio, for testing the BYOK flow locally

---

## 2. Create the monorepo root

```bash
mkdir actuo && cd actuo
git init
```

Set it up as an **npm workspace** so `frontend`, `backend`, and `shared` can share dependencies and types cleanly:

```json
// package.json (root)
{
  "name": "actuo",
  "private": true,
  "workspaces": ["frontend", "backend", "shared"]
}
```

---

## 3. Scaffold the frontend (Angular, SSR, PWA)

```bash
ng new frontend --ssr --style=css --routing
cd frontend
ng add @angular/pwa
```

`--ssr` gives you Angular's server build out of the box; `@angular/pwa` adds the manifest + service worker scaffolding.

Add Tailwind:
```bash
npm install tailwindcss @tailwindcss/postcss postcss --save-dev
npx tailwindcss init
```

Point `tailwind.config.js`'s `content` at `./src/**/*.{html,ts}`, then add the Tailwind directives to `src/styles.css`. Drop in the custom color/font tokens from **Design Doc §2.2** once the app builds.

```bash
cd ..
```

---

## 4. Scaffold the backend (distinct Node service)

Given the RBAC/guards structure the PRD calls for, NestJS is the better default:

```bash
npx @nestjs/cli new backend --package-manager npm
cd backend
npm install @supabase/supabase-js
cd ..
```

(If you'd rather keep it lighter with Express, that's a fine substitute — just keep the same folder isolation: own `package.json`, own `tsconfig`, own tests.)

---

## 5. Create the shared types folder

```bash
mkdir -p shared/src
```

```json
// shared/package.json
{
  "name": "@actuo/shared",
  "version": "0.0.1",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

This is where DTOs and WebMCP tool `inputSchema` shapes live so frontend and backend never drift out of sync on a contract.

---

## 6. Wire up local dev (frontend ↔ backend)

Add a proxy so the Angular dev server forwards `/api/*` to the local Nest server instead of hitting CORS:

```json
// frontend/proxy.conf.json
{ "/api": { "target": "http://localhost:3000", "secure": false } }
```

```json
// frontend/angular.json → serve.options
"proxyConfig": "proxy.conf.json"
```

Run both in separate terminals for now:
```bash
cd backend && npm run start:dev     # e.g. http://localhost:3000
cd frontend && npm start            # e.g. http://localhost:4200
```

Once both work, add a root `concurrently` script so `npm run dev` at the root starts both together.

---

## 7. Supabase — backend only

In `backend/.env` (never in `frontend/`):
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxx
```

Add `backend/.env` to `.gitignore` immediately, and commit a `backend/.env.example` with blank values so other developers know what's needed. Build your first Supabase table (`users` or `organizations`) and a single Nest module (e.g. `HealthController` hitting Supabase) to confirm the connection before building real features.

---

## 8. Firebase App Hosting — the combined deploy

```bash
firebase login
firebase init apphosting
```

Select your existing Firebase project. Firebase App Hosting expects **one Node entry point**, so you'll need a small root-level server file that, at request time, routes `/api/*` to the compiled Nest app and everything else to Angular's SSR handler — this is the one piece of genuinely fiddly plumbing flagged as a risk in the PRD (§11). Budget real time for it; get a trivial "hello world" version of both routing paths working before building features on top.

---

## 9. Housekeeping

```bash
# root .gitignore
node_modules/
dist/
.env
.angular/
```

Create a `/docs` folder at the repo root and drop `Actuo-PRD.md` and `Actuo-Design-Doc.md` in there for the team to reference.

```bash
git add .
git commit -m "chore: scaffold monorepo (frontend, backend, shared)"
```

---

## 10. Where to go next

From here, **PRD §10 Phase 0** is the build order — auth + expense CRUD first, then the WebMCP tools once there's real data to act on.

## Repo structure at the end of this guide

```
/actuo
  /frontend    → Angular app (SSR, PWA)
  /backend     → Node API service (auth, RBAC, Supabase access, business logic)
  /shared      → shared TypeScript types (DTOs, tool schemas)
  /docs        → Actuo-PRD.md, Actuo-Design-Doc.md, this file
  firebase.json / apphosting.yaml → single Firebase App Hosting config
  package.json → npm workspaces root
```
