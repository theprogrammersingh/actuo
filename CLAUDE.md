# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Phase A (scaffold) is complete and committed. Phase 0 feature work is in progress.
The build order is PRD §10 Phase 0, scoped WebMCP-demo-first.

Source of truth docs live in `docs/`: `Actuo-PRD.md` (features, WebMCP coverage map,
data model), `Actuo-Design-Doc.md` (Aurora Ledger visual identity), and
`Actuo-Project-Initialisation.md` (setup — now partly superseded, see below).

## What Actuo is

A multi-tenant expense management platform (Angular SSR + PWA) that doubles as a
reference implementation of the **WebMCP standard**. Every meaningful user action is
also exposed as a WebMCP tool so an AI agent can drive the app. The differentiated
piece is the **Actuo Copilot** — a site-agnostic chat widget that discovers tools via
`document.modelContext` and reasons with the user's own Gemini key, client-side.

Built for a hackathon deadline (Aug 31, 2026).

## Commands

```bash
npm run dev            # builds shared, then backend (:3000) + frontend (:4200) together
npm run build          # shared -> backend -> frontend, in that order
npm test               # backend + frontend unit tests
```

Both workspaces use **vitest** (Angular CLI 21 and Nest 12 both default to it now — not karma/jest).

```bash
# one backend test file / one test by name
npx vitest run --root backend backend/src/app.controller.spec.ts
npx vitest run --root backend -t "routing contract"
# backend e2e uses a separate config
npx vitest run --config backend/vitest.config.e2e.ts --root backend
# one frontend test
npx vitest run --root frontend -t "AppComponent"
```

`shared/` must be built before either consumer — a missing `shared/dist` shows up as
`TS2307: Cannot find module '@actuo/shared'` in *both* builds at once. `npm run dev`
and `npm run build` handle the ordering.

## Layout

```
/frontend   Angular 21, SSR, PWA, zoneless, Tailwind v4, standalone components + Signals
/backend    NestJS 12 (ESM) — auth, RBAC, business logic, all Supabase access
/shared     @actuo/shared — DTOs, domain types, and WebMCP tool JSON Schemas
/docs       the three planning docs
```

`frontend/` and `backend/` are separate codebases (own package.json, tsconfig, tests)
that ship as **one** Firebase App Hosting deploy: a single Node process routes
`/api/*` to Nest and everything else to Angular's SSR handler.

## Tooling facts that differ from the planning docs

The init guide was written against older assumptions. These are verified on this machine:

- **Tailwind is v4, not v3.** There is no `tailwind.config.js` and no
  `npx tailwindcss init`. The Design Doc §2.2 palette lives in the `@theme` block in
  `frontend/src/styles.css`, which is the single source of truth for design tokens.
  Semantic tokens (`--color-canvas`, `--color-surface`, `--color-card`, `--color-line`,
  `--color-body`, `--color-muted`) are what components should reference; light mode
  overrides only those, under `:root[data-theme='light']`.
- **`@actuo/shared` emits real JS to `shared/dist`** and is consumed through normal
  `node_modules` resolution. Do not add tsconfig `paths` mappings for it — that would
  create a second, divergent resolution route. Both sides are ESM.
- **The API prefix needs a leading slash** (`API_PREFIX = '/api'` in
  `backend/src/bootstrap.ts`). Nest normalizes `'api'` to `/api` when mapping routes,
  but mounts its not-found router verbatim via `express.use(prefix, router)`, which
  Express never matches without the slash. Symptom: unknown `/api/*` routes fall
  through to Express's HTML 404 instead of Nest's JSON — and in the composed
  production process they would reach the Angular handler and return the app shell.
  Locked by `backend/test/routing-contract.e2e-spec.ts`.
- **vitest needs `unplugin-swc` for Nest DI.** esbuild does not emit the
  `design:paramtypes` metadata Nest resolves constructor dependencies from, so
  injected services arrive as `undefined`. Both vitest configs load the SWC plugin.
  `nest build` (tsc) is unaffected.
- **`setGlobalPrefix` is load-bearing for the combined deploy**, not cosmetic: without
  a prefix, Nest installs a *global* catch-all 404 that would swallow every Angular route.

## WebMCP API reality (verified against shipped types, not the PRD's prose)

`document.modelContext` is correct and current; `navigator.modelContext` is a deprecated
alias. Types come from `webmcp-types` (published by Chrome DevRel, mirrors the W3C draft),
registered in `frontend/tsconfig.app.json`.

The core spec is `registerTool()`, `getTools()`, and the `toolchange` event. Two things
the PRD assumes that do **not** hold:

- **`executeTool()` is not in the core spec.** It is a feature-detectable *Chromium*
  extension: `executeTool(tool, inputArgumentsJsonString, {signal}) => Promise<string|null>`.
- **`getTools()` returns descriptors with no execute handle** — name, title, description,
  inputSchema, window, origin, annotations. There is no way to call a tool from what it returns.

Two live compatibility traps for any `getTools()` consumer:

1. **`inputSchema` type varies by Chrome version.** Chrome 149–153 (most of the origin-trial
   population, including the Chrome 152 on this machine) return it as a **serialized JSON
   string**; 154+ returns an object. Branch on `typeof` and guard the parse.
2. **`title` may be an empty string**, not absent — `tool.title ?? tool.name` silently yields
   `""`. Use `tool.title || tool.name`. `annotations` genuinely may be absent.

**Enabling native WebMCP** (Chrome 152): `chrome://flags/#enable-webmcp-testing`
("Enables the WebMCP API") and `chrome://flags/#devtools-webmcp-support`, or launch with
`--enable-blink-features=WebMCP`.

**Cross-origin requires native Chrome.** `@mcp-b/webmcp-polyfill` rejects non-empty
`fromOrigins`/`exposedTo` with `NotSupportedError`, so the polyfill is a same-origin
fallback only.

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

### The tool registry decision

Because `getTools()` hands back descriptors with no execute handle and `executeTool()` is
Chromium-only, the Copilot cannot be built the way the PRD describes. Instead a single
`ToolRegistry` service in the frontend is the source of truth. Each tool is defined once
(name, description, JSON Schema from `@actuo/shared`, annotations, `execute`), and the registry:

- registers it with `document.modelContext.registerTool()` when available, so *external*
  browser agents see genuine WebMCP tools;
- keeps the `execute` functions locally, so the **in-page Copilot calls them directly** —
  which works in every browser, with no flag and no `executeTool()`;
- falls back to feature-detected `executeTool()` only for **cross-origin** tools discovered
  via `getTools({fromOrigins})` — the one path that genuinely needs it.

This keeps the app fully functional without the Chrome flag (the judge-without-the-flag
fallback) and confines flag dependence to the cross-origin demo. It also gives
`tool_call_log` and the debug panel a single choke point.

Tool `execute()` functions are plain async functions — unit-test them in isolation. Every invocation (human or agent) is written to `tool_call_log`, which powers both the audit trail and the demo narrative.

## UI conventions

- Dark-first "Aurora Ledger" theme; light mode is first-class, not an afterthought. Theme tokens live in the `@theme` block of `frontend/src/styles.css` as the single source of truth (palette in Design Doc §2.2). There is no `tailwind.config.js` — Tailwind v4 is CSS-first.
- Components reference the **semantic** tokens (`bg-canvas`, `bg-surface`, `bg-card`, `border-line`, `text-body`, `text-muted`), not the raw palette. Light mode overrides only those, so theme parity stays in one place instead of every component.
- The `aurora` gradient is scarce by rule: Copilot orb/thinking state, key onboarding moments, chart accents — never more than one element per viewport.
- `status.*` colors are reserved strictly for state signalling, never decoration.
- Tabular numerals (`font-variant-numeric: tabular-nums`) everywhere money is displayed.
- Mobile-first: bottom tab bar on phones (Copilot opens as a full-screen sheet), left rail on desktop (Copilot as a floating panel, never modal-blocking).
- Utility classes directly in templates; avoid heavy `@apply` abstraction. Small internal component layer (`Button`, `Card`, `Badge`, `Input`, `ToolCallCard`, `StatCard`, `ProgressBar`) that everything else composes from.
- Copilot tool-call cards are the signature UX — collapsed one-line human-readable summary (that summary is also the accessible name), expandable to raw input/result, dot indicating read-only vs mutating.

## SEO / agent discoverability

Public pages (landing, Copilot docs) are SSR'd with structured data, OG tags, `robots.txt`, `sitemap.xml`, target Lighthouse SEO ≥95. Authenticated app views are deliberately `noindex` and excluded from the sitemap.
