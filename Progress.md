# Actuo — Progress Tracker

Tracks every feature in the PRD against what is actually in the codebase.

**Last audited:** 2026-09-03 · **Baseline:** 12 shared · 142 backend unit · 37 backend e2e · 815 frontend

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
| **Anything deployed** | `pnpm run verify:deploy <url>`. Local green does not mean deployed correct — SSR fell back to CSR in production while every test passed, and the page looked fine |

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

## §6.3 Budgets — ✅

| Item | Phase | Status | Notes |
|---|---|---|---|
| Per-category budgets | 1 | ✅ | `budgets.service.ts:status` unions budgeted and spent categories |
| Per-team budgets | 2 | ⬜ | No team entity exists |
| Threshold alerts (80%) | 1 | ✅ | `isNearBudget` in `budget-rollup.ts` (≥80% utilization), dashboard notice, "Nearing budget" badge in the list, `atWarningThreshold` in `get_budget_status` tool output |
| Rollover vs reset | 1 | ✅ | `rollover` checkbox in the form. Carry logic in `budgets.service.ts:status()`: `effective = declared + max(0, prevDeclared − prevSpent)`. One prior month only, unspent is carried, overspend is never debt. 4 tests pin behaviour. UI shows carry: "₹50,000 + ₹8,000 carried" |
| Budget creation/edit UI | 1 | ✅ | Upsert form on the Budgets page for owner/admin — POST new, PATCH existing. Edit button on each row. Rollover checkbox, carry amount display when > 0 |

**Verify:** with a category over budget, confirm the bar turns danger-toned and
the figure matches a hand-check against the expense rows. At ≥80%, confirm
"Nearing budget" badge appears and the dashboard notice fires.

## §6.4 Approvals — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Five statuses + state machine | 1 | ✅ | `expense-state-machine.ts`; all 20 illegal transitions tested |
| submit → approve/reject | 1 | ✅ | UI controls on every row. Self-approval is banned in one shared rule (`NOT_ON_OWN_ACTIONS`) that the server enforces and the UI reads, so the button is not offered either |
| Multi-step chains | 2 | ⬜ | One decision ends the flow |
| Comment thread | 2 | 🟡 | `approvals.comment` is written on a decision; there is no read path, no thread, and no way to comment without deciding |

**Verify:** submit as member, approve as owner, confirm the member cannot approve
their own expense.

## §6.5 Multi-currency — ✅

| Item | Phase | Status | Notes |
|---|---|---|---|
| Original + converted amounts stored | 1 | ✅ | Columns exist. `core/expense/amount.ts` owns the rule: `sumSpend()` adds only base-currency rows and reports the rest |
| Live FX + daily cache | 1 | ✅ | `backend/src/fx/` reads ECB rates from `api.frankfurter.dev` and caches them in `fx_rates` (migration `0003`). Keyed on the date *asked for*, not the date the rate is from, or every weekend lookup would miss forever; the only entry that can go stale is today's while it still stands in for an earlier day. `FxService.rateOn` returns `null` rather than throwing, so an unreachable publisher cannot stop an expense being filed |
| Historical rate lock | 1 | ✅ | `expenses.fx_rate` + `fx_rate_date`, written with `converted_amount` at the expense's own date. **`fx_rate_date` is not `expense_date`** — the ECB publishes once per working day, so a Saturday expense locks Friday's rate, and the row prints the rate's own date. An edit re-locks on amount, currency *or* date. Verified live: AWS filed 2026-08-29 (a Saturday) carries the 2026-08-28 rate |
| Embedded converter (advisory) | 1 | ✅ | `converter/currency-converter.ts` frames a separate converter app on `/convert`, `/agent`, the dashboard notice and foreign-currency expense rows. One frame at a time, lazily mounted, `CONVERTER_URL` from `GET /api/config` |

> **The exclusion rules were what made FX cheap to land.** `sumSpend()` returns
> `{total, excluded}` and `sumByCategory()` returns `unconverted` — a row counts
> only when it has a base-currency value, and the ones that do not are counted
> and stated rather than added at face value. That held, so foreign rows
> re-entered every total the moment `converted_amount` started being filled:
> **`core/expense/amount.ts` needed no logic change at all**, only a comment and
> a line of copy that had gone out of date. `unconvertedCount` still exists and
> still reaches `get_budget_status`; it is now normally 0, and means "no rate
> could be locked" rather than "FX does not exist".
>
> **The seed's foreign rows were worse than excluded — they were quietly
> wrong.** They shipped with a `converted_amount` at hand-written rates (₹87/$
> for Figma, ₹94/€ for Sentry) that no publisher ever quoted, so they counted
> toward every total with nothing to explain them. `--restate` replaced all five
> with dated ECB rates, and picked up two real rows (AWS $200, Starbucks $45)
> that had no conversion at all. Applied 2026-09-03: 7 rows locked, 0 failures,
> books up ₹25,136, and the dashboard's 14-day figure hand-checks to ₹54,669
> against its rows.
>
> **The embedded converter does not change any of that, deliberately.** It is a
> reference a person reads, framed from a separate origin; it writes nothing,
> and `CurrencyConverter` has no `output()` and no `postMessage` listener, so
> there is no channel a converted figure could travel back through. That
> absence is the enforcement, and `currency-converter.spec.ts` asserts it
> directly — along with the two surface specs proving that opening the lookup
> moves neither the row's amount nor the dashboard total. `amount.spec.ts` is
> untouched by this work, which is the point: if a change here needed to edit
> it, the change would be wrong.

**Verify:** file expenses in two currencies and confirm the dashboard total is
not a naive sum. A foreign row shows what it was converted from and on which
day's rate; a row on a weekend names the preceding working day.

## §6.6 Analytics — 🟡

| Item | Phase | Status | Notes |
|---|---|---|---|
| Trend line | 1 | ✅ | Hand-rolled SVG in `spend-pace.ts`, no chart library |
| Spend pace / forecast | 1 | ✅ | Straight-line projection, on-track/watch/over |
| Spend by category | 1 | ✅ | `GET /api/analytics/summary` returns `byCategory` with per-category spend and share. Also `get_spend_summary` WebMCP tool |
| Month-over-month deltas | 1 | ✅ | `monthOverMonthDelta` in `AnalyticsSummary`, percentage change vs prior month (null when no prior data). Exposed in `get_spend_summary` tool output |
| Team vs individual | 2 | ⬜ | — |
| CSV export | 0 | ✅ | Chunked, cancellable, complete across pages |
| **PDF export** | 2 | ⬜ | `pdf` is now **rejected** rather than silently answered with CSV. `shared/src/report-format-contract.spec.ts` pins the tool schema and the backend DTO to the same list |
| `/api/analytics/*` | 1 | ✅ | `backend/src/analytics/` module with `GET /api/analytics/summary`. Returns current/prior month totals, MoM delta, per-category breakdown, excluded counts. 7 unit tests |

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
| **Cross-origin tool use** | 0 | ✅ | The converter is framed from `CONVERTER_URL` with `allow="tools"`, and `ConverterSession` owns discovery for all four surfaces. The synthetic partner page and its :4201 server are gone: dev and production now frame the same independently deployed converter, so there is no cross-origin path that is only exercised in one of them. **Verified 2026-09-03 in Chrome 151 with the flag**, first from `localhost:4200` — all seven of its tools discovered over a real origin boundary, badges correct (4 read-only / 3 mutating), and `executeTool(convertCurrency, {amount:200,from:'EUR',to:'INR'})` returning `200 EUR = 22,018.00 INR` with the embedded widget moving to match — and then **from the deployed Actuo at `/agent`**, which closes the last gap: two genuinely public origins, neither serving the other |

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
| Cross-origin tools | ✅ | See §6.8. Needs a genuinely second origin — same-origin descriptors are filtered out, which is what made the earlier in-repo page unprovable. It is now a separately built, independently deployed app Actuo does not own, and it is proven from the deploy itself, not only from localhost |
| Security annotations | ✅ | `readOnlyHint` on all five, driving the shell's re-poll and the `/agent` panel. `untrustedContentHint` on `search_expenses` and `approve_expense` — the two that surface *another person's* free text — and on the converter's tools, whose results carry third-party rate data; shown as a badge on the tool-call card |
| `getTools()` discovery | ✅ | Drives the cross-origin path and the `/agent` panel; re-runs on `toolchange`. The Copilot still reads its own registry for local tools, deliberately — see "the tool registry decision" |
| `executeTool()` + manual debug panel | 🟡 | `executeTool()` done, and `/agent` renders `Copilot.crossOriginTools` and the registry's `invocationLog()`. Still read-only: there is no form to invoke a tool by hand with arbitrary arguments |

> Open question: `generate_report` is annotated `readOnlyHint: true` but creates a
> server-side job. Defensible, but decide it deliberately.

## §8.4 PWA — ✅

`@angular/service-worker` installed and enabled on the production build only.
`frontend/public/manifest.webmanifest`, icons generated by
`scripts/generate-brand-assets.mjs` (192, 512, maskable, apple-touch), and
`ngsw-config.json`.

**`dataGroups` is empty on purpose** — caching `/api` would show stale money and
would undercut the promise that every read goes through an authenticated route.
`navigationUrls` no longer needs a `/partner-demo/**` exclusion — the converter
is a different origin, which the service worker never sees.

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
| SSR on public pages | 🟡 | `app.routes.server.ts` prerenders `**`, including authenticated routes, which hydrate client-side (correct for a gated view, accidental rather than chosen). **Was broken on the deploy until 2026-09-03, and not for the documented reason:** Angular downgrades to CSR on any untrusted `x-forwarded-*` header, and Render sends `x-forwarded-for`; a host-allowlist miss is a 400 instead. `frontend/src/server.ts` now trusts the full proxy set |
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
| **CI** | ✅ | `.github/workflows/ci.yml` runs the full Definition of Done gate on push and PR, and **has run on GitHub** — five successful runs, most recently on PR #4 |
| Single-process deploy | ✅ | `server.mjs`; the routing contract it depends on is pinned by `routing-contract.e2e-spec.ts`. It also mounts `common/canonical-redirect.ts`, which 308s pages on any non-canonical hostname — placed after Nest so `/api` can never reach it, and before the Angular handler so it also covers the static files that skip Angular's host check. It self-disables when `PUBLIC_ORIGIN`'s host is not in `NG_ALLOWED_HOSTS`, because that combination would 308 the alias to a host Angular 400s: every page down behind a health check that still returns 200 |

## §12 Submission criteria — 🟡

| Item | Status | Notes |
|---|---|---|
| **Public deployed URL** | ✅ | **Live at `https://actuo.programmersingh.dev`**, with `https://actuo.onrender.com` kept as an alias that 308s to it. `server.mjs` composes Nest under `/api` with the Angular SSR handler from a committed `Dockerfile`; Firebase App Hosting was abandoned after three distinct buildpack failures against this workspace monorepo (see README *Why a Dockerfile*). Attaching the custom domain broke it in the documented way — every page 400'd on the new host until it was added to `NG_ALLOWED_HOSTS` — and in one that was **not** caught by any check: the SEO stamp is baked at build time, so the new domain served a sitemap, `canonical` and `og:image` all naming the old origin. `verify:deploy` now asserts the stamped origin matches the URL it is checking |
| README | ✅ | Root `README.md`: what is WebMCP-specific and where, the flag setup, what works without it, and the deploy steps. Workspace READMEs are still starter boilerplate |
| Demo video | ⬜ | The last box left. The script is the "What to look at" list in `README.md`, and the SSR fix it was waiting on has landed — the deployed site server-renders, so a recording made now records the real thing |
| Source with clear tool definitions | ✅ | `shared/src/tools.ts` |

---

## What to fix next

Every Phase 0 row is green, real FX landed on 2026-09-03, the deploy is live on
its own domain, and cross-origin is proven from that deploy. What is left is the
rest of Phase 1, and the video.

1. **Budgets depth** — three open §6.3 rows, one surface. `POST /budgets`
   inserts and there is no PATCH, so a budget can be set once and not changed;
   the form hides categories that already have one rather than offering a
   guaranteed 409. Threshold alerts (80%) and rollover-vs-reset are the other
   two, and `budgets.spec.ts` already guards the rollover checkbox against
   returning without its behaviour.
2. **`/api/analytics/*`** — no controller; the dashboard derives everything
   client-side. Standalone spend-by-category and a month-over-month delta tile
   are the visible half.
3. **Recurring expenses** — `recurring_templates` is in PRD §8.7 and **absent
   from the migrations**, so it needs `0004`.
4. **Org invites** — the last Phase 1 row, and the only one needing an external
   service (Resend, plus a `sync: false` secret in `render.yaml`).
5. **Demo video** — the last §12 checkbox. The script is the "What to look at"
   list in `README.md`.
6. **Everything else is Phase 2–3**: receipt OCR, notifications, multi-step
   approval chains, comment threads, teams, tags, CSV import, PDF export,
   session management, and packaging the Copilot as a standalone script.

### Known rough edges, deliberately not fixed here

- **The Firebase App Hosting backend may still be connected** with auto-rollouts,
  in which case it fails on every push. Deleting it is
  `firebase apphosting:backends:delete actuo --project actuo-2f1f3`. App Hosting
  itself is no longer the target — see README *Why a Dockerfile* — and the issue
  that killed it is [firebase-tools#10435](https://github.com/firebase/firebase-tools/issues/10435),
  closed as not planned.
- **`/agent` is a sixth tab on mobile.** The labels fit (widest is "Dashboard" at
  ~54px in a 65px slot at 390px, measured), but it is tight, and this was
  verified by measurement rather than at a real 390px viewport.
- **No CSP header is set anywhere yet.** When one lands it will need `frame-src`
  for the converter origin (`CONVERTER_URL`) — one origin now, not two — or
  every converter surface breaks silently: an iframe blocked by CSP renders
  empty with no error the page can see. It also has to be written against the
  *canonical* host, since that is the only origin that serves pages now.
- **Brand assets are generated, not designed.** `scripts/generate-brand-assets.mjs`
  produces the icons and og card from the palette with ImageMagick. They are
  clean but plain, and regenerating after a palette change is manual.
