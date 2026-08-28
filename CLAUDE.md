# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repo contains **only planning docs** — no code, no `package.json`, no git repo yet. The three source-of-truth documents are:

- `Actuo-PRD.md` — product requirements, feature set, WebMCP coverage map, data model, roadmap
- `Actuo-Design-Doc.md` — visual identity ("Aurora Ledger"), Tailwind theme tokens, UX patterns
- `Actuo-Project-Initialisation.md` — step-by-step scaffolding guide

Anything about build/test/lint commands below describes what the initialisation guide prescribes, not what exists. Verify before running.

## What Actuo is

A multi-tenant expense management platform (Angular SSR + PWA) that doubles as a reference implementation of the **WebMCP standard**. Every meaningful user action is also exposed as a WebMCP tool so an AI agent can drive the app. The differentiated piece is the **Actuo Copilot** — a site-agnostic chat widget that discovers tools via `document.modelContext.getTools()` and runs them via `executeTool()`, reasoning with the user's own Gemini key client-side.

Built for a hackathon deadline (Aug 31). PRD §10 Phase 0 is the build order; §11 lists open decisions that are still genuinely open.

## Planned repo layout (npm workspaces)

```
/frontend    Angular app (SSR, PWA, standalone components, Signals, Tailwind)
/backend     NestJS API service — auth, RBAC, business logic, all Supabase access
/shared      @actuo/shared — DTOs and WebMCP tool inputSchema shapes
/docs        the three planning docs
firebase.json / apphosting.yaml   single Firebase App Hosting service
```

`frontend/` and `backend/` are deliberately separate codebases (own `package.json`, own tsconfig, own tests) even though they ship as **one** Firebase App Hosting deploy: a root-level Node entry point routes `/api/*` to the compiled Nest app and everything else to Angular's SSR handler.

## Scaffolding commands (from the init guide)

```bash
ng new frontend --ssr --style=css --routing && (cd frontend && ng add @angular/pwa)
npx @nestjs/cli new backend --package-manager npm
```

Local dev runs both processes; `frontend/proxy.conf.json` forwards `/api` → `http://localhost:3000` to avoid CORS.

```bash
cd backend && npm run start:dev   # :3000
cd frontend && npm start          # :4200
```

A root `concurrently` script (`npm run dev`) should start both once each works standalone.

## Architectural rules that must not be violated

These are the load-bearing constraints — most bugs worth preventing here are violations of one of them.

1. **Data boundary.** The frontend never imports `@supabase/supabase-js` and never talks to Supabase. Every read/write goes through a `backend/` route that enforces auth + RBAC first. The service-role key lives only in `backend/.env`.
2. **LLM boundary.** The user's Gemini API key lives in browser storage (`localStorage`/`IndexedDB`) and is **never sent to, proxied by, or logged by the backend**. All LLM calls — Copilot reasoning, OCR-assist, auto-categorization — go directly browser → Gemini API. This is demoable in the network tab and is a stated product promise; treat any code path that would send the key server-side as a bug.
3. **Structural boundary.** `backend/` must not depend on `frontend/`'s build. Shared contracts go in `shared/`, not cross-imports.
4. **Gemini-only, BYOK.** v1 supports no other LLM provider. The model list must be a small editable config (models churn), not hardcoded deep in UI.
5. **RBAC server-side.** Never trust client role claims. Roles are `owner` / `admin` / `member`.
6. **Strict CSP.** Because the Gemini key sits in the browser, XSS is a key-theft vector, not just session theft. CSP and dependency hygiene carry more weight here than in a typical app.

## WebMCP coverage is a requirement, not a nice-to-have

PRD §7 is a checklist every row of which needs a concrete implementation. When adding a tool, know which aspect it demonstrates:

- **Declarative** — the Add Expense quick-entry form is annotated HTML with *no* JS tool registration. Keep it plain.
- **Imperative** (`registerTool`) — `submit_expense`, `search_expenses`, `get_budget_status`, `approve_expense`, `generate_report`
- **State-gated** — `approve_expense` registers only when the user is `admin`/`owner` AND a pending item exists; emits `toolchange`
- **Cancellation** — `generate_report` honors `AbortSignal`; the UI must react within ~100ms
- **Cross-origin** — the Copilot must work embedded on an unrelated demo page (iframe + `exposedTo`/`fromOrigins`/`allow="tools"`) with no code changes
- **Security annotations** — `readOnlyHint` on reads; mutating/sensitive tools require in-chat confirmation before executing

Tool `execute()` functions are plain async functions — unit-test them in isolation. Every invocation (human or agent) is written to `tool_call_log`, which powers both the audit trail and the demo narrative.

## UI conventions

- Dark-first "Aurora Ledger" theme; light mode is first-class, not an afterthought. Theme tokens live in `tailwind.config.js` as the single source of truth (palette in Design Doc §2.2).
- The `aurora` gradient is scarce by rule: Copilot orb/thinking state, key onboarding moments, chart accents — never more than one element per viewport.
- `status.*` colors are reserved strictly for state signalling, never decoration.
- Tabular numerals (`font-variant-numeric: tabular-nums`) everywhere money is displayed.
- Mobile-first: bottom tab bar on phones (Copilot opens as a full-screen sheet), left rail on desktop (Copilot as a floating panel, never modal-blocking).
- Utility classes directly in templates; avoid heavy `@apply` abstraction. Small internal component layer (`Button`, `Card`, `Badge`, `Input`, `ToolCallCard`, `StatCard`, `ProgressBar`) that everything else composes from.
- Copilot tool-call cards are the signature UX — collapsed one-line human-readable summary (that summary is also the accessible name), expandable to raw input/result, dot indicating read-only vs mutating.

## SEO / agent discoverability

Public pages (landing, Copilot docs) are SSR'd with structured data, OG tags, `robots.txt`, `sitemap.xml`, target Lighthouse SEO ≥95. Authenticated app views are deliberately `noindex` and excluded from the sitemap.
