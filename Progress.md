# Actuo — Progress Tracker

Tracks every feature in the PRD against what is actually in the codebase.

**Last audited:** 2026-08-29 · **Baseline:** 9 shared · 64 backend unit · 34 backend e2e · 742 frontend

Status is evidence-based, not aspirational. A row is `DONE` only when the code
exists, is reachable from the running app, and has a test. A file existing is not
evidence; a stub, a TODO, or a service method with no caller is `PARTIAL` at best.

| | |
|---|---|
| ✅ `DONE` | Implemented, reachable in the app, tested |
| 🟡 `PARTIAL` | Some of it exists — the row says exactly what is missing |
| ⬜ `TODO` | Not started |
| 💀 `DEAD` | Code exists and is tested, but **nothing calls it** — invisible to a user |

`DEAD` is called out separately because it is the most dangerous state: it looks
finished in the source and in the test count, and does nothing in the product.

---

## Definition of Done

**Every task runs this gate before its status changes to ✅.** Each step is here
because skipping it caused a real failure in this project, not as ceremony.

### 1. Typecheck
```bash
pnpm --filter backend exec tsc --noEmit -p tsconfig.json
pnpm --filter frontend exec tsc --noEmit -p tsconfig.app.json
```
Use `pnpm exec`, **never `npx`**. npx does not resolve workspace binaries — it
silently downloaded an unrelated `tsc` package from the registry and reported
success.

### 2. Both test suites
```bash
pnpm test          # shared + backend unit + frontend
pnpm run test:e2e  # backend e2e — separate config, NOT included above
```
Run **both**. A change was committed here after unit tests alone and broke an e2e
spec that pinned the same data. The frontend suite must go through `ng test`
(`pnpm --filter frontend run test`) — bare `vitest` cannot work, because Angular's
builder generates the TestBed bootstrap.

### 3. Build
```bash
pnpm run build     # shared → backend → frontend, in that order
```
Catches things tests miss: `shared` specs leaking into `dist`, SSR prerender
failures, template type errors.

### 4. Run it and look at it
```bash
pnpm run dev       # backend :3000, frontend :4200
```
Open the feature and use it. Tests did not catch the aurora-scarcity violation
(two gradients in one viewport), and a dead `ng serve` behind a live
`concurrently` supervisor presented exactly as "the backend API is broken."

### 5. Check the boundary this change touches

| Change touches | Verify |
|---|---|
| **AI / Copilot** | DevTools → Network: the Gemini key appears **only** in requests to `generativelanguage.googleapis.com`, never to our origin |
| **Data / API** | The route is authenticated and RBAC is enforced server-side — sign in as `arjun@actuo.demo` (member) and confirm the action is refused |
| **WebMCP** | Works in flag-enabled Chrome (`chrome://flags/#enable-webmcp-testing`) **and** still works with the flag off |
| **Money / totals** | The number is right on a dataset larger than one page (100 rows) — truncation shows a wrong figure, not an obvious gap |
| **UI** | Both themes, phone and desktop widths, keyboard reachable |

### 6. Update `CLAUDE.md`
Only if the change alters a rule, a command, or a non-obvious constraint that
would otherwise be rediscovered the hard way.

### 7. Commit
Explain *why*, not just what. Note anything you could not verify.

### 8. Stop what you started
```bash
pkill -f "concurrently/dist/bin"        # supervisor FIRST, or it respawns children
pkill -f "nest start"; pkill -f "ng serve"
lsof -nP -iTCP:3000,4200 -sTCP:LISTEN   # must print nothing
```
Killing children while the supervisor lives leaves a half-dead stack that looks
alive. Always verify after — `pkill`'s exit status is not proof.

---

## §6.1 Auth & Multi-tenancy — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Email/password, argon2id | 0 | ✅ | `backend/src/auth/auth.service.ts`; hash asserted in `auth.e2e-spec.ts` |
| JWT access + rotating refresh | 0 | ✅ | Single-use `jti`, reuse revokes the whole family |
| Organizations | 0 | 🟡 | Created at signup only. No create/join/switch path |
| Invite by email | 1 | ⬜ | No route, no email transport |
| Roles owner/admin/member | 0 | ✅ | `membership_role` enum + `roles.guard.ts` |
| RBAC at the API layer | 0 | ✅ | Role re-read from `memberships`, never from the token. 17 e2e cases incl. a smuggled role claim |
| Session management screen | 2 | ⬜ | `refresh_tokens` stores `user_agent` and `revokeAllForUser()` exists, but there is no list/revoke endpoint or UI |

**Verify:** sign in as member and as owner; confirm an owner-only route returns
403 for the member *from the API*, not merely hidden in the UI.

## §6.2 Expenses — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Manual entry | 0 | ✅ | `pages/add-expense/add-expense.ts` |
| Tags | 2 | ⬜ | No column, no DTO field |
| Receipt upload + OCR | 2 | ⬜ | `receipt_url` column exists; nothing writes it. No Storage, no OCR |
| Recurring templates | 1 | ⬜ | `recurring_templates` table is **absent from the migration** |
| CSV bulk import | 2 | ⬜ | Export exists; import does not |
| Soft delete | 0 | ✅ | Partial indexes `where deleted_at is null` |
| Audit trail | 0 | ✅ | `GET /api/audit-log` (owner/admin) plus a Change history panel in Settings, beside the renamed Tool calls panel. The copy states the difference: `audit_log` is what changed, `tool_call_log` is what an agent did |
| **Expense actions in the UI** | 0 | ✅ | Submit / approve / reject / reimburse / reopen / delete on every row, offered from `mayPerformOn` in `@actuo/shared` — the same function `ExpensesService.transition` enforces with, so a button that would 403 is never rendered. Decisions take an optional note inline; delete is two-step |

**Verify:** create an expense, confirm it appears in the list and in `audit_log`.

## §6.3 Budgets — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Per-category budgets | 1 | ✅ | `budgets.service.ts:status` unions budgeted and spent categories |
| Per-team budgets | 2 | ⬜ | No team entity exists |
| Threshold alerts (80%) | 1 | ⬜ | Utilization is computed and shown; no threshold, no alert, no notification |
| Rollover vs reset | 1 | 🟡 | `rollover` column is persisted but **read by nothing** — `status()` always computes a fresh calendar month, so the flag has no effect |
| Budget creation UI | 1 | ✅ | A form on the Budgets page for owner/admin. `POST /budgets` inserts and a unique index makes a repeat a 409, so only categories without a budget are offered — **changing** an existing budget is still unsupported (no PATCH route) |

**Verify:** with a category over budget, confirm the bar turns danger-toned and
the figure matches a hand-check against the expense rows.

## §6.4 Approvals — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Five statuses + state machine | 1 | ✅ | `expense-state-machine.ts`; all 20 illegal transitions tested |
| submit → approve/reject | 1 | ✅ | UI controls on every row. Self-approval is banned in one shared rule (`NOT_ON_OWN_ACTIONS`) that the server enforces and the UI reads, so the button is not offered either |
| Multi-step chains | 2 | ⬜ | One decision ends the flow |
| Comment thread | 2 | 🟡 | `approvals.comment` is written on a decision; there is no read path, no thread, and no way to comment without deciding |

**Verify:** submit as member, approve as owner, confirm the member cannot approve
their own expense.

## §6.5 Multi-currency — 🟡 ⚠️

| Item | Phase | Status | Notes |
|---|---|---|---|
| Original + converted amounts stored | 1 | ✅ | Columns exist. `core/expense/amount.ts` owns the rule: `sumSpend()` adds only base-currency rows and reports the rest |
| Live FX + daily cache | 1 | ⬜ | No FX client, no cache, no rates table |
| Historical rate lock | 1 | ⬜ | No rate column |

> **Totals are now honest about what they exclude.** `convertedAmount` is still
> only set when the currency already equals the base currency, so foreign rows
> have no base-currency value. They used to be added at face value — a $200
> charge counted as ₹200. Now a row counts only when it has a converted value,
> and the ones that do not are **counted and stated**: `sumSpend()` returns
> `{total, excluded}`, `sumByCategory()` returns `unconverted`, and that surfaces
> as `BudgetStatus.unconvertedCount`, a muted line on the dashboard and budgets
> screens, and a field in the `get_budget_status` tool result so the Copilot can
> qualify the figure. Row labels follow the same rule — an unconverted $50 prints
> as `$50`, not `₹50`.
>
> This is the honest interim, not the feature: real FX (live rates, daily cache,
> historical lock) is still ⬜, and the moment `converted_amount` starts being
> filled, those rows re-enter every total with no code change.

**Verify:** file expenses in two currencies and confirm the dashboard total is
not a naive sum, and that it says how many rows it left out.

## §6.6 Analytics — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Trend line | 1 | ✅ | Hand-rolled SVG in `spend-pace.ts`, no chart library |
| Spend pace / forecast | 1 | ✅ | Straight-line projection, on-track/watch/over |
| Spend by category | 1 | 🟡 | Only via `/budgets/status`; no standalone breakdown |
| Month-over-month deltas | 1 | 🟡 | Computed for the pace benchmark; no delta tile |
| Team vs individual | 2 | ⬜ | — |
| CSV export | 0 | ✅ | Chunked, cancellable, complete across pages |
| **PDF export** | 2 | 🟡 | `format: 'pdf'` is **accepted and silently returns CSV**. Either implement it or reject the value |
| `/api/analytics/*` | 1 | ⬜ | No controller; the dashboard derives everything client-side |

## §6.7 Notifications — ⬜

Table exists and is seeded. No repository, module, route, bell UI, or email
transport. **Phase 2.**

## §6.8 Copilot — 🟡 (strongest area)

Cross-origin is live as of 2026-08-29; only the standalone-script packaging (Phase 3) is left.

| Item | Phase | Status | Notes |
|---|---|---|---|
| Floating widget, orb → panel | 0 | ✅ | Full-screen sheet on mobile |
| Gemini function calling, BYOK client-side | 0 | ✅ | Key never reaches our origin; enforced by `key-privacy.spec.ts` |
| Thought signatures preserved | 0 | ✅ | Replayed verbatim; required by Gemini 3 or the second tool turn 400s |
| Tool-call cards | 0 | ✅ | Name, summary, expandable IO, read-only vs mutating dot |
| Confirmation before mutating tools | 0 | ✅ | In-chat card. PRD says "native dialog"; in-chat was chosen deliberately |
| Key-setup flow when no key | 0 | ✅ | Opens into setup rather than failing silently |
| Embeddable via one `<script>` | 3 | ⬜ | It is an Angular component inside the app shell |
| **Cross-origin tool use** | 0 | ✅ | `/agent` embeds the partner page from `PARTNER_DEMO_ORIGIN` (:4201, `scripts/partner-server.mjs`) with `allow="tools"` and calls `discoverRemoteTools()`. Verified in Chrome 151 with the flag: both partner tools discovered, `executeTool()` returned a price cross-origin |

## §6.9 Admin & Settings — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Gemini key management | 0 | ✅ | Masked, show/hide, Test key, two-step clear, non-persistent-storage warning |
| Model selector | 0 | ✅ | Served from `/api/config` so churn needs no rebuild; retired models kept and labelled |
| Org settings | 2 | 🟡 | Displays name and currency; no edit route |
| Category management | 2 | 🟡 | Read-only list; no create/rename/delete |
| Approval rules | 2 | ⬜ | — |
| **Audit log viewer** | 2 | ✅ | `ToolCallAudit` POSTs every invocation. Verified live: a Copilot-path tool call appears under Agent, an Add Expense submit under Human |

## §7 WebMCP Coverage Map — the learning checklist

| Aspect | Status | Notes |
|---|---|---|
| Declarative API (annotated form) | ✅ | Add Expense: `toolname`/`tooldescription`/`toolparamdescription`/`toolautosubmit`, `agentInvoked` + `respondWith`, **no JS registration** |
| Imperative `registerTool` | ✅ | Five tools, per-tool `AbortController` lifetime |
| JSON Schema inputs | ✅ | One definition in `shared/src/tools.ts`, used by client and server |
| **Dynamic / state-gated tools** | ✅ | The shell polls on sign-in and after every mutating call. Verified live: `approve_expense` present in `getTools()` as owner with 3 pending, absent as member, and every tool retired on sign-out |
| Cancellation (`AbortSignal`) | ✅ | Client aborts, polls stop, server abandons the job mid-fetch and mid-format |
| Cross-origin tools | ✅ | See §6.8. Needs a genuinely second origin — same-origin descriptors are filtered out, which is what made the earlier setup unprovable |
| Security annotations | ✅ | `readOnlyHint` on all five, driving the shell's re-poll and the `/agent` panel. `untrustedContentHint` on `search_expenses` and `approve_expense` — the two that surface *another person's* free text — and on the partner-demo tools; shown as a badge on the tool-call card |
| `getTools()` discovery | ✅ | Drives the cross-origin path and the `/agent` panel; re-runs on `toolchange`. The Copilot still reads its own registry for local tools, deliberately — see "the tool registry decision" |
| `executeTool()` + manual debug panel | 🟡 | `executeTool()` done, and `/agent` renders `discoveredTools` and `invocationLog`. Still read-only: there is no form to invoke a tool by hand with arbitrary arguments |

> Open question: `generate_report` is annotated `readOnlyHint: true` but creates a
> server-side job. Defensible, but decide it deliberately.

## §8.4 PWA — ✅

`@angular/service-worker` installed and enabled on the production build only.
`frontend/public/manifest.webmanifest`, icons generated by
`scripts/generate-brand-assets.mjs` (192, 512, maskable, apple-touch), and
`ngsw-config.json`.

**`dataGroups` is empty on purpose** — caching `/api` would show stale money and
would undercut the promise that every read goes through an authenticated route.
`navigationUrls` also excludes `/partner-demo/**`, a separate site that
re-registers its WebMCP tools on each load.

`PwaService` holds the deferred `beforeinstallprompt` and online/offline state;
the shell renders an install banner and an offline banner from it. Verified live
on the production build: one activated worker, `/api` absent from `ngsw.json`,
and the offline banner appearing and clearing on the network events.

## §8.5 SEO — 🟡

| Item | Status | Notes |
|---|---|---|
| robots.txt | ✅ | Gated routes disallowed |
| sitemap.xml | ✅ | Public route only, `<loc>` absolute via the `__PUBLIC_ORIGIN__` stamp |
| Structured data | ✅ | Real `application/ld+json` `SoftwareApplication` |
| llms.txt | ✅ | Accurate tool inventory and permission model |
| OG / Twitter | ✅ | 1200×630 `og.png` generated from the brand tokens, plus `og:url`, `og:image:alt`, `twitter:image` and a canonical link |
| SSR on public pages | 🟡 | `app.routes.server.ts` prerenders `**` — including authenticated routes, which land on the app shell and hydrate client-side (correct for a gated view, accidental rather than chosen). **Was silently broken until 2026-08-29:** Angular 21's `Host` allowlist rejected every request and fell back to CSR, discarding the SSR entirely. Fixed via `security.allowedHosts` + `NG_ALLOWED_HOSTS`; the check is that `/` contains `ng-server-context` |
| noindex on gated views | ✅ | `data.robots` per route, applied by `SeoService` on every navigation; a route that declares nothing defaults to `noindex`. Verified live: the tag flips going from `/` to `/expenses` |

## §9 Non-functional

| Item | Status | Notes |
|---|---|---|
| RBAC server-side | ✅ | — |
| Rate limiting on auth | ✅ | In-process fixed window; per-instance only |
| Paginated, indexed queries | ✅ | One shared page cap; callers needing all rows paginate |
| Migrations + seed | ✅ | Applied to the hosted project; `0002` idempotent |
| Supabase call timeouts | ✅ | 8s deadline — a stall used to hang the request forever |
| Unit tests for tool `execute()` | ✅ | — |
| Structured logging / error tracking | ⬜ | Nest logger only; no Sentry-tier reporting |
| **CI** | 🟡 | `.github/workflows/ci.yml` runs the full Definition of Done gate on push and PR. Never executed by GitHub — verified by running its exact command sequence locally |
| Single-process deploy | ✅ | `server.mjs`; the routing contract it depends on is pinned by `routing-contract.e2e-spec.ts` |

## §12 Submission criteria — ⬜

| Item | Status | Notes |
|---|---|---|
| **Public deployed URL** | 🟡 | The deploy path is **built and verified locally**: `server.mjs` composes Nest under `/api` with the Angular SSR handler, and a `Dockerfile` builds and runs it. Both builder stages plus the runtime boot were simulated locally — `/api/health` 200, `/api/*` 404 as JSON, `ng-server-context` present. Firebase App Hosting was abandoned after three distinct buildpack failures against this workspace monorepo (see README *Why a Dockerfile*). What is left is the actual `gcloud run deploy`, which needs an interactive Google login |
| README | ✅ | Root `README.md`: what is WebMCP-specific and where, the flag setup, what works without it, and the deploy steps. Workspace READMEs are still starter boilerplate |
| Demo video | ⬜ | The script is the "What to look at" list in `README.md` |
| Demo video | ⬜ | — |
| Source with clear tool definitions | ✅ | `shared/src/tools.ts` |

---

## What to fix next

Every Phase 0 row is green as of 2026-08-29. What is left is the deploy itself,
the video, and Phase 1–3 features.

1. **Run the deploy.** Everything is committed; the remaining steps need an
   interactive Google login — see the Deploying section of `README.md`. The
   project `actuo-2f1f3` exists and has no App Hosting backend yet; App Hosting
   needs the Blaze plan.
   *Verify:* `/api/health` returns JSON on the public URL; `/` returns HTML
   containing `ng-server-context` (if not, `NG_ALLOWED_HOSTS` is wrong and the
   site is rendering client-side); `PUBLIC_ORIGIN` set, so `<loc>` in the
   sitemap is absolute.
2. **Demo video** — the last §12 checkbox. The script is the "What to look at"
   list in `README.md`.
3. **Real FX** — live rates, a daily cache, a historical lock at write time.
   Totals are honest about the gap now, but they still exclude real spend.
4. **Editing an existing budget** — `POST /budgets` inserts and there is no
   PATCH, so a budget can be set once and not changed. The form hides categories
   that already have one rather than offering a guaranteed 409.
5. **Everything else is Phase 1–3**: receipt OCR, notifications, recurring
   templates (the table is not in the migration), multi-step approval chains,
   comment threads, teams, tags, CSV import, PDF export, session management,
   org invite/switch, `/api/analytics/*`, and packaging the Copilot as a
   standalone script.

### Known rough edges, deliberately not fixed here

- **The cross-origin demo cannot work on the deployed URL as configured.** The
  partner page ships inside the app, so on a deploy it is same-origin, and
  `/agent` says so rather than showing an empty list. Hosting
  `frontend/public/partner-demo/` elsewhere and setting `PARTNER_DEMO_ORIGIN` is
  a small follow-up.
- **CI has never run on GitHub.** The workflow was verified by running its exact
  command sequence locally; `act` is not installed on this machine.
- **Firebase App Hosting has an open issue with pnpm workspaces**
  ([firebase-tools#7478](https://github.com/firebase/firebase-tools/issues/7478),
  `lockfile not found`) that reproduces when the app is in a *subdirectory*.
  `rootDir: "/"` keeps the lockfile where the installer looks — the arrangement
  least likely to hit it, but untested against the real builder. If it fails,
  `node server.mjs` runs unchanged on Cloud Run, Render or Fly.
- **`/agent` is a sixth tab on mobile.** The labels fit (widest is "Dashboard" at
  ~54px in a 65px slot at 390px, measured), but it is tight, and this was
  verified by measurement rather than at a real 390px viewport.
- **No CSP header is set anywhere yet.** When one lands it will need `frame-src`
  for the partner origin, or the cross-origin demo breaks silently.
- **Brand assets are generated, not designed.** `scripts/generate-brand-assets.mjs`
  produces the icons and og card from the palette with ImageMagick. They are
  clean but plain, and regenerating after a palette change is manual.
