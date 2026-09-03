# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Every Phase 0 item is built and committed — scaffold, backend, design system,
BYOK Gemini layer, WebMCP tool layer, Copilot, app shell, expense workflow UI,
PWA, SEO, and the single-process deploy path. Remaining: running the actual
Firebase deploy, and the demo video. Everything else in the PRD is Phase 1–3.

Build order is PRD §10 Phase 0, scoped WebMCP-demo-first.

Source of truth docs live in `docs/`: `Actuo-PRD.md` (features, WebMCP coverage map,
data model), `Actuo-Design-Doc.md` (Aurora Ledger visual identity), and
`Actuo-Project-Initialisation.md` (setup — partly superseded: it predates both
Tailwind v4 and the move to pnpm, so follow the commands here rather than there).

## What Actuo is

A multi-tenant expense management platform (Angular SSR + PWA) that doubles as a
reference implementation of the **WebMCP standard**. Every meaningful user action is
also exposed as a WebMCP tool so an AI agent can drive the app. The differentiated
piece is the **Actuo Copilot** — a site-agnostic chat widget that discovers tools via
`document.modelContext` and reasons with the user's own Gemini key, client-side.

Built for a hackathon deadline (Aug 31, 2026).

## Comments

The comment density here is deliberate and it is high — 3,850 comment lines
across 27,649, and files like `core/expense/amount.ts` and `webmcp/tool-call-audit.ts`
are over half prose. **That is the design, not an accident, and not cleanup
backlog.** Most of what this repo knows that a reader cannot infer — why
`approved` is not `success`, why `turnsToContents()` replays raw parts, why a
$200 charge must not be added to a rupee total — lives in those comments. A
sweep that removes them destroys the most valuable thing in the codebase.

So "remove unnecessary comments" here means a very short list:

- ASCII rule lines that carry no words (`// ------------------`), including the
  two rules wrapped around a section title. Keep the title, drop the rules.
- Commented-out code, and comments describing code that no longer exists.
- A comment that only restates the line beneath it.

**Never remove**, however verbose:

- Any comment saying *why* — a rejected alternative, a bug it prevents, a spec
  quirk, a rule that looks arbitrary until explained.
- `LOAD-BEARING`, `ORDER IS SIGNIFICANT`, and "do not simplify this away" notes.
  Several exist because the simplification was already tried and broke something
  subtle: thought signatures, `parseInputSchema()`, `setGlobalPrefix`.
- PRD/Design-Doc section references (`PRD §6.4`, `§2.2`) — they are the link back
  to the source of truth.
- JSDoc `@example` blocks. They look like commented-out code and are not.

Measure before sweeping. A scan of all 177 source files found only 16 removable
lines — 5 comments restated their code, zero were stale TODOs, zero were
commented-out code. If a comment sweep proposes to remove hundreds of lines, it
has misread prose as noise; stop and re-read the list above.

## Commits

**No commit message, PR title, or PR body in this repo mentions Claude, Claude
Code, or names an AI as a collaborator.** Specifically, never append any of:

- `Co-Authored-By: Claude ...` — or any `Co-Authored-By` trailer naming an AI
- `Claude-Session: https://claude.ai/code/...`, or a bare `claude.ai/code` URL
- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

This **overrides the default Claude Code commit and PR trailers** — do not add
them back "because the tool normally does". The work is authored by the repo's
git user alone; a co-author trailer attributes it to a contributor who is not
one, and GitHub then renders that account on every commit and in the repo's
contributor list.

History was rewritten once, on 2026-08-29, to strip those two trailers from all
18 commits on `main` and `revive-webmcp-dead-features`. Re-introducing them
means doing that rewrite again, so check `git log` before committing.

Naming the file `CLAUDE.md` in a message is fine — it is a real file in the
repo, and several commits legitimately say they changed it.

## Commands

**This repo uses pnpm.** Do not run `npm install` — it would create a competing
`package-lock.json` and a hoisted `node_modules` that hides missing dependency
declarations (see "Why pnpm changes things" below).

```bash
pnpm install           # `pnpm install --frozen-lockfile` is the CI equivalent of `npm ci`
pnpm run dev           # shared, then backend (:3000) + frontend (:4200)
pnpm run build         # shared -> backend -> frontend, in that order
pnpm test              # backend + frontend unit tests
pnpm run test:e2e      # backend e2e
```

Both workspaces use **vitest** (Angular CLI 21 and Nest 12 both default to it now — not karma/jest).

```bash
# backend: one file, or one test by name
pnpm --filter backend exec vitest run src/app.controller.spec.ts
pnpm --filter backend exec vitest run -t "routing contract"
pnpm --filter backend run test:e2e

# frontend: MUST go through ng test, which is the @angular/build:unit-test builder
pnpm --filter frontend run test
pnpm --filter frontend exec ng test --no-watch --filter "ToolRegistry"
```

The name filter is `--filter` (a regex over suite and test names). It is **not**
`--test-name-pattern` — that is vitest's own flag, and the Angular builder rejects
it outright with `Unknown argument`.

`frontend`'s `test` script already carries `--no-watch`, deliberately: npm swallows a
bare `--` while pnpm forwards it to Angular as an empty argument, which the builder
rejects with a schema error. Keeping the flag inside the script makes it behave the
same under any package manager. Use `test:watch` for the watching variant.

**Do not run the frontend suite with bare `npx vitest`.** Angular's builder generates the
TestBed bootstrap (`init-testbed.js`) as part of the test build; without it every spec that
touches `TestBed` dies with `Cannot read properties of null (reading 'ngModule')`. Specs with
no Angular dependency happen to pass, which makes the breakage look selective and confusing.

`webmcp-types` must be listed in the `types` array of **both** `frontend/tsconfig.app.json`
and `frontend/tsconfig.spec.json`, or the `WebMCP` namespace resolves in the app build and
fails in the test build.

`shared/` must be built before either consumer — a missing `shared/dist` shows up as
`TS2307: Cannot find module '@actuo/shared'` in *both* builds at once. `pnpm run dev`
and `pnpm run build` handle the ordering.

## Layout

```
/frontend   Angular 21, SSR, PWA, zoneless, Tailwind v4, standalone components + Signals
/backend    NestJS 12 (ESM) — auth, RBAC, business logic, all Supabase access
/shared     @actuo/shared — DTOs, domain types, and WebMCP tool JSON Schemas
/docs       the three planning docs
```

`frontend/` and `backend/` are separate codebases (own package.json, tsconfig, tests)
that ship as **one** Firebase App Hosting deploy: a single Node process routes
`/api/*` to Nest and everything else to Angular's SSR handler. That process is
`server.mjs` at the repo root — see "The deploy" below.

## Why pnpm changes things

The workspace manifest is **`pnpm-workspace.yaml`**, not a `workspaces` field in
`package.json`. Add a new package there.

pnpm links only what a package *declares*, with no hoisting. That is stricter than npm
and it immediately exposed two real bugs npm had been masking:

- **`@actuo/shared` was imported by 52 files but declared as a dependency nowhere.** It
  resolved only because npm hoists every workspace package into the root `node_modules`.
  Both consumers now declare `"@actuo/shared": "workspace:*"`.
- **`shared` never declared `typescript`**, yet its build script runs `tsc`. It was
  borrowing the root's binary.

So: if an import resolves, some package.json must say so. A missing declaration now
fails loudly at install or build time instead of working by accident.

**`onlyBuiltDependencies` in `pnpm-workspace.yaml` is load-bearing.** pnpm blocks
dependency lifecycle scripts by default, so native bindings never get built — esbuild,
`@swc/core` (which vitest needs for Nest DI), `argon2`, and `lightningcss` all fail in
different, confusing ways if dropped from that list. Add a package there when a new
native dependency appears.

pnpm also fixes the lightningcss problem npm had: it records every platform variant in
the lockfile and installs the matching one, so the explicit `optionalDependencies` pin
npm needed is gone.

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
   population, including the Chrome 151 on this machine) return it as a **serialized JSON
   string**; 154+ returns an object. Branch on `typeof` and guard the parse.
2. **`title` may be an empty string**, not absent — `tool.title ?? tool.name` silently yields
   `""`. Use `tool.title || tool.name`. `annotations` genuinely may be absent.

**Enabling native WebMCP** (Chrome 151 here): `chrome://flags/#enable-webmcp-testing`
("Enables the WebMCP API") and `chrome://flags/#devtools-webmcp-support`, or launch with
`--enable-blink-features=WebMCP`.

**Both traps are confirmed on this machine, not theoretical.** Re-measured on
2026-09-03 against the deployed converter (`https://cambiaro.programmersingh.dev`)
framed from `localhost:4200` in Chrome **151** with WebMCP enabled — a genuine
origin boundary, not a page this repo serves. `getTools({fromOrigins})` returned
all seven of its tools with `typeof inputSchema === 'string'`, and
`executeTool()` resolved to a JSON **string** rather than an object. So
`registerTool` with `exposedTo`, the `readOnlyHint` annotation, `fromOrigins`
discovery and `executeTool()` all work end to end across origins.
`parseInputSchema()` and `parseToolResult()` are what keep that working — do not
"simplify" them away.

The same run proved the loop closes: `executeTool(convertCurrency, {amount:200,
from:'EUR', to:'INR'})` returned `200 EUR = 22,018.00 INR (1 EUR = 110.09 INR,
2 Sep 2026)` **and the embedded widget moved to that conversion** — which is what
the other side marking those tools as changing its own UI buys. Annotations
survive the boundary intact: its four answering tools rendered `Read-only` in
`/agent` and its three UI-moving ones `Mutating`.

**Cross-origin requires native Chrome.** `@mcp-b/webmcp-polyfill` rejects non-empty
`fromOrigins`/`exposedTo` with `NotSupportedError`, so the polyfill is a same-origin
fallback only.

**Cross-origin also requires an actual second origin, and it must not be one we
serve.** A page served by the app is marked `isCrossOrigin: false` by
`normalizeRegisteredTool()`, which is exactly the set the Copilot filters out.
This repo used to ship a synthetic partner page (`frontend/public/partner-demo/`)
plus a static server on :4201 to give it a second origin; both are gone. They
were only ever true on localhost, and a stand-in exercised in dev but never in
production is how a path stays broken in one of them unnoticed.

What the app frames is **`CONVERTER_URL`** (it replaced `PARTNER_DEMO_ORIGIN`),
served to the browser by `GET /api/config` — so a deploy changes it without a
rebuild. **Development and production now use the same real converter**; the dev
default is the public one, which costs a network dependency and buys one code
path instead of two.

It is a **full URL rather than a bare origin** because a converter need not sit
at the root of its host — a GitHub Pages *project* site is
`<user>.github.io/<repo>/`, and only a custom domain puts it at `/` — and the
`?actuo=` handshake is appended to it either way. Consumers derive the origin
with `new URL(value).origin`; a second "path" variable that had to stay in step
would be one too many. Non-http(s) values are rejected before the sanitizer
bypass. When it equals the app's own origin, every surface says so instead of
showing an empty list. It is deliberately **not** defaulted in production: a
deploy names the converter it trusts rather than inheriting one.

**The `?actuo=` handshake is what makes any of it work.** A WebMCP tool is
visible only to its own document unless registration names an origin in
`exposedTo`, so the framed page has to be *told* which origin to expose to.
`ConverterSession.frameUrl` appends `?actuo=<our origin>`, and the converter
reads it and passes it to `registerTool`'s `exposedTo`.
Sending it at runtime rather than hardcoding our hostname there means a deploy
URL can change without a release on the other side.

**`ConverterSession` owns the discovery lifecycle, not any page.** It used to
belong to `/agent`, which was fine while one page framed one other origin. With four
surfaces, page-owned teardown cleared the Copilot's remote tools while a frame
was still mounted elsewhere. Two rules live there now: **only one frame at a
time** (`getTools()` returns a descriptor per *window*, so two live frames
publish two tools called `convertCurrency`), and **reference-counted discovery**
(during a route change Angular builds the incoming component before destroying
the outgoing one, so clear-on-destroy would wipe what the new surface just
found). `Copilot.discoverRemoteTools()` also dedupes by name now, which fixes
the same duplicate-window bug wherever a second window publishes the same tools.

## The deploy

**`Dockerfile` + Render, not Firebase App Hosting.** App Hosting failed to
build this repo three times, each for a different reason inside its Node
buildpack and none reproducible locally:

1. It reads `engines.pnpm` as a *range* and installs the highest match, ignoring
   `packageManager` — so `">=10"` selected pnpm 12, whose branch in the buildpack
   launches the standalone binary from `bin/dist/pnpm.mjs`, a path that exists
   only in the npm package layout. `MODULE_NOT_FOUND`.
2. Capped at pnpm 9, `pnpm install` died with `Cannot convert undefined or null
   to object` in ~314ms — before any network fetch, so a config parse. That is
   firebase-tools#10435, filed for pnpm monorepos on any pnpm version and
   **closed as not planned**. Five local variations install cleanly.
3. Migrated to npm, the install succeeded and the *build* failed:
   `npm run build --workspace=@actuo/shared` reported `No workspaces found` in
   the builder's tree though it resolves everywhere else. That migration was
   reverted; the repo is on pnpm.

All three are the builder disagreeing with a workspace monorepo, so the fix was
to stop using a builder. `apphosting.yaml` and `firebase.json` are deleted — they
are in git history if App Hosting is ever revisited, but check #10435 first.

`server.mjs` at the repo root is the production entry point and needed no change
through any of it: a plain Node server reading `$PORT` and binding `0.0.0.0`,
which is why the image runs unmodified on Render, Cloud Run or Fly. It imports
the two build outputs and composes them in one process.

`render.yaml` is the Blueprint Render builds from — it names the Dockerfile,
`/api/health` as the probe, and every environment variable except the three
secrets, which are `sync: false` and prompted for once at creation. **Render
translates a service env var into a Docker build argument**, which is the only
reason `PUBLIC_ORIGIN` can be declared there alongside the runtime ones; the
Dockerfile declares `ARG PUBLIC_ORIGIN` to receive it. Changing it needs a
*rebuild*, not a restart — a runtime variable cannot reach prerendered HTML.

- It appends the Angular handler to **Nest's own Express instance**, after Nest's
  routes. That works only because `setGlobalPrefix('/api')` scopes Nest's
  not-found router to `/api` instead of installing a global catch-all — the
  property `backend/test/routing-contract.e2e-spec.ts` exists to pin. If that
  spec breaks, the deploy is broken too, in a way that returns the app shell for
  a bad API call.
- The built Angular SSR bundle is **self-contained** (only `node:` imports;
  Express is bundled in) and serves `dist/browser` itself. That is why the
  runtime stage copies no `frontend/node_modules`.
- `createNodeRequestHandler` returns its argument unchanged, so the exported
  `reqHandler` *is* the Express app and mounts directly as middleware.

**The Dockerfile does not prune.** `pnpm prune --prod` was tried: in a workspace
it prompts, and then leaves `@angular/cli` and `typescript` in place anyway. A
larger image beats a step that silently half-works.

**`NG_ALLOWED_HOSTS` is load-bearing, and it fails silently.** Angular 21 checks
the `Host` header against an allowlist (SSRF protection). Off the list it does not
error — it falls back to **client-side rendering**, quietly discarding the SSR and
structured-data work in PRD §8.5. The env var *replaces* the build-time list in
`angular.json` (`getAllowedHostsFromEnv() ?? options.allowedHosts`), so a deploy
must list every hostname it answers on. The port is stripped before matching, and
`*.example.com` wildcards match by suffix (`isHostAllowed` turns `*.x` into
`hostname.endsWith('.x')`), so one wildcard covers a multi-label host. Verify
with: the HTML for `/` contains `ng-server-context`. `angular.json` carries
`localhost` so `node server.mjs` renders locally.

**`PUBLIC_ORIGIN` is a BUILD-time variable, not a runtime one** — a `Dockerfile`
`ARG`. On Render it is declared as a normal env var only because Render turns
those into build args; on any other host it needs an explicit `--build-arg`. The public pages are prerendered, so absolute
URLs — `<loc>` in the sitemap, `og:image`, `canonical` — must be decided before
the build finishes. `index.html`, `sitemap.xml` and `robots.txt` carry a
`__PUBLIC_ORIGIN__` sentinel that survives prerendering into every generated
file, and `scripts/stamp-seo.mjs` replaces it across `dist/frontend/browser` as
the last step of `pnpm run build`. Unset, it substitutes `''` and everything
stays root-relative and valid. It must carry the scheme: the value is
substituted verbatim, so a bare hostname yields a `<loc>` that is not a URL.

**The service worker must never cache `/api`.** `ngsw-config.json` has no
`dataGroups` at all, deliberately: a cached response would show stale money and
would undercut the promise that every read goes through an authenticated route.
`navigationUrls` no longer needs a `/partner-demo/**` exclusion — the converter
is a different origin, which the service worker never sees.

**`NODE_ENV=production` changes one behaviour on purpose**: `EnvService.converterUrl`
drops its development default, because a deploy should name the converter it
trusts through `CONVERTER_URL` rather than silently framing a third party nobody
chose. Unset, the converter surfaces say so.
It is set in the runtime stage of the Dockerfile, and deliberately NOT at build
time — a production-flagged install drops devDependencies, and the build is
almost entirely devDependencies.

## The expense workflow is one table, shared

Which action is legal, who may perform it, and on whose row — all of it lives in
`shared/src/domain.ts` (`canTransition`, `TRANSITION_ROLES`,
`OWNER_ONLY_ACTIONS`, `NOT_ON_OWN_ACTIONS`, `mayPerformOn`). `ExpensesService.transition`
enforces it and `core/expense/expense-actions.ts` renders from it, so a button
cannot appear for something the server would refuse.

`backend/src/expenses/expense-state-machine.ts` keeps only what is genuinely
server-side — the 409 mapping — and re-exports the rest.

Two rules that look alike and are not: `OWNER_ONLY_ACTIONS` (submit, rework) is
"only your own row, unless you are an approver"; `NOT_ON_OWN_ACTIONS` (approve,
reject) is "never your own row, whoever you are" — segregation of duties.
Getting them confused is how the UI briefly offered an Approve button that always
403'd.

## Module map

**backend/** — `auth/` (argon2id + JWT, rotating refresh, guards), `expenses/`
(CRUD, search, the status state machine), `budgets/`, `reports/` (polled job for
the cancellation demo), `tool-calls/` (audit log), `orgs/`, `config/`
(`GET /api/config` serves the Gemini model list so it is editable without a
rebuild), `supabase/` (client + repository seam), `common/` (rate limiting).
Migrations live in `supabase/migrations/`. Seed users: `priya@actuo.demo`
(owner), `arjun@actuo.demo` (member), password `Demo1234!`.

Three global guards run in order — rate limit, JWT, roles — so a route without
`@Public()` fails closed. `RolesGuard` reads the role from `memberships` per
request; the access token deliberately carries no role claim.

**frontend/src/app/**
- `ui/` — design system (`Button`, `Card`, `Badge`, `Input`, `StatCard`,
  `ProgressBar`, `Skeleton`, `EmptyState`, `ErrorState`, `ToolCallCard`), barrel
  at `ui/index.ts`, plus an unrouted `ui/showcase/`.
- `ai/` — BYOK Gemini layer. `KeyStore`, `GeminiClient`, `ModelCatalog`,
  `testGeminiKey`, typed `GeminiError`. **`GeminiClient.generate()` takes RAW
  `{name, description, inputSchema}` declarations and runs the OpenAPI
  translation itself — never pre-convert with `toFunctionDeclarations()`, or the
  schema lands under `parameters` where the second pass cannot see it and every
  tool reaches the model with no arguments.**
- `core/seo/` — `SeoService` applies each route's `data.robots` on every
  navigation. A meta tag is document-global, so a component that sets one on
  load leaves it behind; that is how `index, follow` used to end up on
  `/dashboard`. A route that declares nothing is treated as `noindex`.
- `core/pwa/` — `PwaService`: the deferred install prompt and online/offline,
  surfaced as a banner in the shell.
- `core/expense/` — the money rules (`sumSpend`) and the workflow rules
  (`availableActions`), both pure functions over `@actuo/shared`.
- `webmcp/` — `ToolRegistry` and `ToolSession` (state gating), plus
  `ToolCallAudit`, which POSTs every invocation to `/api/tool-calls`.
  `ToolRegistry.observe()` is the single seam every invocation passes through;
  `App` subscribes once and fans out to the audit write and the
  pending-approval re-poll. Keep HTTP and session dependencies out of the
  registry itself — that is what keeps its spec free of fakes.
- `tools/` — the five tool `execute()` implementations over `/api/*`.
- `copilot/` — `Copilot` (the agent loop) and `CopilotPanel` (orb + panel).
- `core/api/` — `ApiClient`. `core/theme/` — `ThemeService`.
- `pages/add-expense/` — the declarative WebMCP form. It is the only tool call a
  *human* can make, so it logs itself with the actor `agentInvoked` reports;
  everything else through the registry is an agent.
- `pages/agent/` — `/agent`, the WebMCP surface made visible: browser support,
  the cross-origin converter iframe and what it exposed, and the live invocation
  log. The only consumer of `discoveredTools()` and `invocationLog()`.

## Thought signatures (Gemini 3 function calling)

Gemini 3 attaches an opaque `thoughtSignature` to `functionCall` parts. It **must**
be echoed back verbatim when the model turn is replayed in `contents`, or the next
request fails with HTTP 400:

> Function call is missing a thought_signature in functionCall parts. This is
> required for tools to work correctly.

Google's own SDKs handle this silently; we call the REST API directly (deliberately
— bundle size and a tight CSP), so it is ours to preserve.

The defence is structural rather than field-by-field: a model turn carries the
candidate's **raw `parts`**, and `turnsToContents()` replays them byte-for-byte
instead of rebuilding them from `text`/`functionCalls`. Rebuilding drops any field
we do not model, and which fields exist is Google's to change. **Do not "simplify"
that by reconstructing parts** — it re-introduces the bug, and only on the *second*
request of a tool loop, so single-turn tests will not catch it.

Each call in a parallel batch has its own signature; never synthesise or reuse one.

## Gemini schema translation

Gemini's function-calling dialect is an OpenAPI 3.0 subset, and our contracts
use keywords it rejects (`additionalProperties`, `format`, `default`,
`exclusiveMinimum`). `toGeminiSchema()` folds those into the description rather
than dropping them — so the model still knows a date is `YYYY-MM-DD` and that
`limit` defaults to 20. Dropping them silently makes the model measurably worse.

## Progress tracking

`Progress.md` at the repo root tracks every PRD feature against what is actually
implemented, and carries the **Definition of Done** gate that every task runs
before its status changes. Update it in the same commit as the work — a tracker
that lags is worse than none, because it is believed.

It uses a `DEAD` status for code that exists and passes tests but has **no
caller**, so it does nothing in the running app. Three headline features are in
that state today; `DEAD` is separated from `PARTIAL` precisely because it looks
finished in both the source and the test count.

## Money: never add two currencies

There is no FX pass. `expenses.service.ts` writes `converted_amount` **only**
when the expense is already in the org's base currency, so it is `null` for
every foreign row — and the seed data has INR, USD and EUR.

So a row counts toward a total only when it has a base-currency value, and the
ones that do not are **counted and stated**, never dropped and never added:

- Frontend: `core/expense/amount.ts` — `isConverted()`, `sumSpend()` (returns
  `{total, excluded}`), `expenseCurrency()` for the label on a single row, and
  `excludedNotice()` for the copy. Every rollup goes through `sumSpend`.
- Backend: `sumByCategory()` sums only non-null `converted_amount` and returns
  `unconverted`; that reaches the client as `BudgetStatus.unconvertedCount`, and
  the `get_budget_status` tool passes it to the model so the Copilot can qualify
  the figure rather than state a partial total as a complete one.

The earlier code fell back to the raw `amount`, on the reasoning that a slightly
wrong number beat a bar reading zero. It was not slightly wrong: a $200 charge
was counted as ₹200. When a real FX pass starts filling `converted_amount`,
those rows re-enter every total with no code change.

**The embedded converter does not change this, and must not.** `converter/`
frames a separate converter app on four surfaces (`/convert`, `/agent`, the
dashboard's excluded-rows notice, and expense rows in another currency). It is
advisory: a rate a person reads off another site is not the historical rate
locked at entry, so nothing it shows may reach `converted_amount`, `sumSpend()`,
`sumByCategory()`, or the `excludedNotice()` copy.

That is enforced structurally rather than by good intentions:
`CurrencyConverter` has **no `output()`, no `postMessage` listener, and never
reads a value back out of the frame**, so no converted figure exists anywhere in
Actuo's component tree to be wired in. Adding one would mean first inventing a
return channel — a visible, reviewable act rather than a one-line slip.
`currency-converter.spec.ts` asserts the component's inputs and outputs
directly, and the dashboard and expenses specs assert that opening the lookup
moves no figure. **`core/expense/amount.ts` and its spec were not touched by
that work**; if a change to the converter needs to edit them, the change is
wrong.

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
