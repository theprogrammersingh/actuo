# Actuo — Product Requirements Document
### AI-Native Expense Intelligence Platform with a Universal WebMCP Copilot

**Version:** 0.1 (Draft)
**Owner:** Simar Preet Singh
**Last updated:** August 27, 2026

---

## 1. Vision

Actuo is a full-featured, multi-user expense management platform that doubles as a **learning and showcase vehicle for the WebMCP standard**. It is not a toy CRUD app — it's built to feel like a real fintech SaaS product (think Ramp/Expensify-level polish) while every meaningful interaction is *also* exposed as a WebMCP tool, so an AI agent — whether it's a browser-native agent, the "Actuo Copilot" widget we build ourselves, or a third-party assistant — can operate the app on the user's behalf with full transparency.

Actuo is **BYOK (Bring Your Own Key)**: the app never holds or proxies an LLM key on the server. Each user supplies their own **Google Gemini API key** in Settings, and it stays in the browser — used only for direct, client-side calls to the Gemini API. Actuo itself is Gemini-only for now, with a model selector limited to Gemini models.

Actuo is also **mobile-first and installable** (a Progressive Web App), and built to be discoverable and legible to both search engines and AI agents/crawlers, not just human visitors.

One codebase, one deployable unit:

- **Actuo** — the expense management app: a single Angular (SSR, mobile-first PWA) application, packaged as one deployable and shipped on **Firebase App Hosting**. Server-side logic within the same app talks to **Supabase** (Postgres + Storage) — the frontend never calls Supabase directly.
- **Actuo Copilot** — a portable, embeddable WebMCP-aware chat widget that discovers a page's registered tools via `getTools()` and drives them via `executeTool()`, reasoning with the user's own Gemini key directly from the browser. It's built generically enough that it could theoretically sit on any WebMCP-enabled site, not just Actuo — this is the differentiated, "haven't seen before" piece for hackathon judging.

---

## 2. Problem Statement

- Expense tracking tools are either too simple (spreadsheets) or too rigid (enterprise SaaS with slow support flows and buried settings).
- Emerging agentic browsers can already "see" a page, but they actuate it by clicking around — slow, fragile, and error-prone for anything financial.
- There's no widely-known reference implementation that demonstrates the **full surface area** of WebMCP (declarative + imperative, state-aware tools, cross-origin tool sharing, cancellation, security annotations) in a single, coherent, real-feeling product.

---

## 3. Goals

| Goal | Metric |
|---|---|
| Learn & demonstrate every core WebMCP capability | All 8 aspects listed in §7 implemented and demoable |
| Ship a genuinely "complex" app, not a toy | ≥10 advanced features live (see §6) |
| Build a reusable, site-agnostic copilot widget | Copilot works on Actuo AND at least one other unrelated demo page without code changes |
| Zero server-side LLM key exposure | Gemini key never leaves the browser; confirmable via network tab in the demo |
| Installable, mobile-first experience | Passes PWA installability checks; usable one-handed on a phone |
| Discoverable by search engines and AI agents | Public pages server-rendered with structured data; Lighthouse SEO ≥95 |
| Be hackathon-submittable | Deployed, public URL, <3 min demo script, README, video-ready flows |
| Production-credible engineering | Auth, RBAC, migrations, tests, CI-deployable |

### Non-goals (for v1)
- Real payment processing / bank account linking (mock or manual entry only)
- Native mobile apps (the installable PWA covers this need instead)
- Support for LLM providers other than Gemini (architecture should stay swappable later, but v1 is Gemini-only)
- Multi-language i18n (English only for v1)

---

## 4. Target Users / Personas

1. **Individual user (Aanya)** — freelancer tracking personal expenses, wants fast entry and clear monthly insights.
2. **Team admin (Rohit)** — runs a 5-person startup, needs shared budgets, approval workflows, and visibility into team spend.
3. **Team member (Priya)** — submits expenses for reimbursement, wants to know approval status without digging through menus — ideal candidate for Copilot-driven interactions ("show me my pending reimbursements").
4. **The "agent"** — not a human at all. A first-class actor in this product: it should be able to do everything a logged-in human can do, within permission boundaries, transparently, and revocably.

---

## 5. Core User Flows

- Sign up / log in (email+password, session via JWT + refresh token)
- Create/join an **Organization** (multi-tenant)
- Add expense (manual entry, receipt photo upload, or Copilot-driven natural language: "I spent ₹450 on lunch at Barista yesterday")
- Categorize (manual + AI auto-suggestion)
- Set up recurring/subscription expenses
- Create budgets per category/team, get alerted on overage
- Submit expense for reimbursement → approval workflow → status tracking
- View analytics dashboard (spend trends, category breakdown, forecast)
- Multi-currency entry with live FX conversion to a base currency
- Export reports (CSV/PDF) for a date range
- Admin: manage members, roles, budgets, approval rules
- Talk to Actuo Copilot to do any of the above via chat, with every tool call visibly logged in a side panel as it happens

---

## 6. Feature Set (this is the "complexity" layer)

### 6.1 Auth & Multi-tenancy
- Email/password auth (bcrypt/argon2 hashing), JWT access token + rotating refresh token
- Organizations (tenants) with invite-by-email
- Roles: `owner`, `admin`, `member` — RBAC enforced at API layer
- Session management screen (active devices, revoke)

### 6.2 Expense Management
- Manual entry with category, tags, notes, currency, date, merchant
- Receipt upload with image storage (S3-compatible or Firebase Storage) + OCR extraction (merchant/amount/date auto-fill) — use a vision-capable LLM call or a lightweight OCR API
- Recurring expense templates (subscriptions) with next-due tracking
- Bulk import via CSV
- Soft-delete + audit trail (who changed what, when)

### 6.3 Budgets & Alerts
- Per-category and per-team monthly budgets
- Threshold-based email/in-app alerts (e.g. 80% of budget used)
- Rollover vs. reset budget modes

### 6.4 Approval Workflows
- Member submits expense → routes to admin/owner for approval
- Multi-step approval chains (optional, for orgs with >1 approver tier)
- Status states: `draft → submitted → approved/rejected → reimbursed`
- Comment thread per expense

### 6.5 Multi-Currency
- Store amounts in original currency + converted base-currency value
- Live FX rate fetch (cached daily) via a public FX API
- Historical rate lock at time of entry
- **Embedded currency converter (advisory):** a separate converter app is framed on `/convert`, on `/agent`, beside the dashboard's excluded-rows notice, and on expense rows filed in another currency. It is a *reference*, not a rate source — nothing it shows is written to `converted_amount`, folded into a total, or allowed to change the excluded-rows copy. Until the FX pass above exists, a total that says what it left out stays the honest answer; a rate looked up today is not the historical rate locked at entry.
- The converter is a genuinely separate origin exposing its own WebMCP tools, so it is also how §7's cross-origin row is satisfied on a real deploy (see §6.8).

### 6.6 Analytics & Forecasting
- Dashboard: spend by category/time, team vs. individual breakdown
- Trend lines, month-over-month deltas
- Simple forecast (linear projection or moving average) for "spend pace this month"
- Exportable PDF/CSV reports

### 6.7 Notifications
- In-app notification center (approvals needed, budget alerts, recurring expense due)
- Email notifications (transactional, e.g. via Resend/SendGrid)

### 6.8 Actuo Copilot (the WebMCP centerpiece)
- Floating chat widget, embeddable via a single `<script>` tag
- Discovers tools on the current page via `document.modelContext.getTools()`
- Sends the user's natural-language request + tool schemas **directly from the browser** to the **Gemini API** (using the user's own BYOK key and their selected Gemini model), via Gemini's function-calling support, and gets back a tool call plan
- Executes via `executeTool()`, streaming visible "tool call" cards (name, input, result) into the chat — full transparency, no black box
- Confirms before executing any tool flagged as sensitive (e.g. `submit_expense`, `delete_expense`) via a native confirmation dialog
- Works cross-origin: can be dropped onto a *second*, unrelated demo page (e.g. a simple bookstore or todo app) to prove genericity
- If no key is set yet, the Copilot opens straight into the key-setup flow rather than failing silently

### 6.9 Admin/Settings
- Org settings, category management, currency defaults, approval rule configuration
- **Gemini API key management:** paste/update/clear a Gemini API key; stored only in the browser (see §8.3); a "Test key" action makes one lightweight call to confirm it works
- **Model selector:** dropdown of available Gemini models (e.g. Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5 Flash) used for both the Copilot and any in-app AI features (categorization, OCR-assist); verify the current model line-up at build time, since Gemini's lineup shifts
- Audit log viewer

---

## 7. WebMCP Coverage Map

This table is the actual "learning checklist" — every row must have a concrete tool in the app.

| WebMCP Aspect | Where it's used in Actuo |
|---|---|
| **Declarative API** (HTML form annotation) | "Add Expense" quick-entry form — pure HTML, no JS tool registration |
| **Imperative API** (`registerTool`) | `submit_expense`, `get_budget_status`, `search_expenses`, `approve_expense`, `generate_report` |
| **JSON Schema inputs** | Every tool above has a strict schema (enums for category/currency, required fields) |
| **Dynamic/state-gated tools** | `approve_expense` tool only registered when the logged-in user has `admin`/`owner` role AND there's a pending item; listens to `toolchange` |
| **Cancellation (`AbortSignal`)** | `generate_report` (long-running export) supports cancel mid-execution |
| **Cross-origin tools** | The Copilot discovers and calls tools published by a **separately built, independently deployed app this repo does not own** (`exposedTo` / `fromOrigins` / `allow="tools"`), over a real origin boundary — in development as well as on the deployed URL. It is not a demo page authored here, which is what the earlier in-repo partner page could never be: served by the app, its tools came back same-origin and were filtered out |
| **Security annotations** | `readOnlyHint` on read tools (`search_expenses`), `untrustedContentHint` / confirmation dialog on mutating tools |
| **Tool discovery (`getTools`)** | Core of the Copilot widget itself |
| **`executeTool()` + manual invocation** | Copilot's execution engine; also a debug panel for manually testing tools while developing |

---

## 8. Technical Architecture

### 8.1 Stack
- **Frontend:** Angular (standalone components, Signals, Angular SSR) + Tailwind CSS — mobile-first, installable PWA. Lives in its own `frontend/` folder in the repo.
- **Backend:** a **distinct Node.js service (NestJS or Express + TypeScript)** in its own `backend/` folder — a real, separately-structured codebase (own `package.json`, own routes/controllers/services layer, own tests), not logic bolted onto Angular's SSR server. Kept structurally separate for clean ownership boundaries even though it deploys as part of one unit (see below).
- **Repo layout (monorepo):**
  ```
  /actuo
    /frontend    → Angular app (SSR, PWA)
    /backend     → Node API service (auth, RBAC, Supabase access, business logic)
    /shared      → shared TypeScript types (DTOs, tool schemas) used by both
    firebase.json / apphosting.yaml → single Firebase App Hosting config
  ```
- **Database & File Storage:** **Supabase** (Postgres + Storage) — accessed **only from `backend/`**, using a Supabase service-role key held in backend environment config. The frontend never imports the Supabase client or talks to Supabase directly; every read/write goes through the backend's API first, which enforces auth/RBAC before touching Supabase.
- **Auth:** JWT + refresh tokens (or Supabase Auth used server-side within `backend/`, fronted by Actuo's own session handling — decide during setup), argon2 password hashing if rolling auth manually
- **LLM layer (BYOK):** **Google Gemini API only.** The user's Gemini API key lives in the browser (see §8.3) and every LLM call — Copilot reasoning, OCR-assist, auto-categorization — is made **client-side, directly to Gemini**, never proxied through the backend. A model selector in Settings restricts choice to Gemini models (e.g. Gemini 3 Pro/Flash, Gemini 2.5 Flash) — reconfirm the current model list at build time.
- **Deployment:** despite the `frontend/` + `backend/` split in source, the two are built and shipped as **one package to Firebase App Hosting** — a single Node process serves Angular's SSR output for page requests and mounts the backend's API routes (e.g. under `/api/*`) side by side. One Firebase App Hosting service, one URL, one deploy — but two clearly separated codebases behind it.
- **CI:** GitHub Actions — lint/test/build both `frontend/` and `backend/` independently, then a combined build step assembles the single deployable, deployed to Firebase App Hosting on merge to `main`

### 8.2 High-Level Architecture

```
              ┌───────────────────────────────────────────────────────┐
              │      Actuo — one Firebase App Hosting service          │
              │      (built from two separate repo folders)             │
              │                                                          │
              │   /frontend (Angular SSR, PWA)   /backend (Node API)    │
Browser  ───▶ │        │                               │                │
(mobile-first │        │  page requests                │ /api/* routes  │
 PWA)         │        ▼                               ▼                │
              │   Angular SSR render          Auth · RBAC · business    │
              │   + WebMCP tool                logic · Supabase access  │
              │   registration                        │                 │
              │   (document.modelContext)              │                 │
              └────────────────────────────────────────┼─────────────────┘
                                                          │
                                                          ▼
                                          [Supabase: Postgres + Storage]
                                          (reached only from /backend)
                                                          │
                                                          ▼
                                                   [FX rate API] (cached)
        │
        │ Gemini API key (BYOK) stored in browser only
        ▼
   [Gemini API] ◀── direct client-side calls (Copilot reasoning, OCR-assist, categorization)
        ▲
        │ getTools() / executeTool()
[Actuo Copilot widget] ──────────────────────────────▶ [Angular app's WebMCP tool registry]
        │
        └── embeddable on a 3rd-party page via iframe (cross-origin demo)
```

**Key architectural rule:** two separate trust boundaries, deliberately kept apart —
1. **Data boundary:** Supabase credentials never reach the browser; all data access is mediated by the `backend/` service's own routes.
2. **LLM boundary:** the Gemini key never reaches the backend; all LLM calls are made directly from the browser with the user's own key.
3. **Structural boundary:** `frontend/` and `backend/` are separate codebases with separate concerns and separate tests, even though they ship inside one Firebase App Hosting deploy.

### 8.3 BYOK Key Handling
- Key entered once in Settings, stored in the browser via `localStorage` (or `IndexedDB` if you want structured storage for multiple saved keys/models later) — **never sent to or logged by the backend**.
- Clearly disclose this in the UI itself (see Design Doc §5): "Your Gemini key is stored only in this browser and is never sent to our servers."
- Because client-side storage is inherently exposed to XSS, treat strict output-encoding and a tight Content-Security-Policy as non-negotiable — a stolen key here is a stolen Gemini key, not just a stolen session.
- A "Clear key" action wipes it from storage immediately, with confirmation.
- The model selector persists alongside the key (also browser-only).

### 8.4 PWA Requirements
- Web app manifest (`manifest.json`) — installable, custom icons, theme color matching the "Aurora Ledger" palette
- Service worker: cache-first for shell/static assets, network-first for data, with a sensible offline fallback screen (not a blank page) for the core Dashboard/Expenses views
- Mobile-first responsive breakpoints — design and build for a phone viewport first, then scale up to tablet/desktop (see Design Doc §3 for the mobile IA)
- Fast Time-to-Interactive on 4G — this matters doubly here since it's also an SEO/Core-Web-Vitals signal

### 8.5 SEO & Agent Discoverability
- Public-facing pages (landing/marketing, docs for the Copilot widget) are **server-rendered** via Angular SSR — not client-only rendered — so both search crawlers and AI agents get real content on first load
- `robots.txt` and `sitemap.xml` for the public routes
- Structured data (schema.org `SoftwareApplication`/`Organization`) on public pages
- Open Graph + Twitter card meta tags for shareable links
- Semantic HTML throughout (proper heading hierarchy, landmark regions) — this also directly benefits the WebMCP declarative form tool, which relies on well-structured HTML
- Consider a public `llms.txt` describing Actuo's purpose and its available WebMCP tools — a nice, on-theme way to make the app self-describing to AI agents, not just humans
- Authenticated app views (Dashboard, Expenses, etc.) are deliberately **not** indexed (`noindex` + excluded from sitemap) — SEO effort concentrates on the public surface, not gated data

### 8.6 API Surface (representative — routes live in `backend/`)
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`
- `GET/POST/PATCH/DELETE /api/expenses`
- `GET /api/expenses/search?query=...`
- `POST /api/expenses/:id/approve`, `POST /api/expenses/:id/reject`
- `GET /api/budgets`, `POST /api/budgets`
- `GET /api/analytics/summary`, `GET /api/analytics/forecast`
- `POST /api/reports/generate` (async job, supports cancellation)
- `GET /api/orgs/:id/members`, `POST /api/orgs/:id/invite`

All of the above are `backend/` routes that call Supabase internally — none of them are Supabase calls made from the browser.

### 8.7 Data Model (core tables, hosted on Supabase Postgres)

```
users            (id, email, password_hash, name, created_at)
organizations    (id, name, base_currency, created_at)
memberships      (id, user_id, org_id, role, joined_at)
categories       (id, org_id, name, icon, is_default)
expenses         (id, org_id, user_id, category_id, amount, currency,
                   converted_amount, base_currency, merchant, note,
                   status, receipt_url, expense_date, created_at, deleted_at)
recurring_templates (id, org_id, expense_template, frequency, next_due_at)
budgets          (id, org_id, category_id, amount, period, rollover)
approvals        (id, expense_id, approver_id, status, comment, decided_at)
audit_log        (id, org_id, actor_id, action, entity, entity_id, metadata, created_at)
notifications    (id, user_id, type, payload, read_at, created_at)
tool_call_log    (id, org_id, actor ('human'|'agent'), tool_name, input, output, created_at)
```

`tool_call_log` is worth calling out — logging every WebMCP tool invocation (human-manual or agent-driven) gives you an audit trail AND a great analytics/demo artifact ("here's every action the agent took this session").

---

## 9. Non-Functional Requirements

- **Security:** RBAC enforced server-side (never trust client role claims), rate limiting on auth endpoints, input validation matching WebMCP JSON schemas on both client and server, HTTPS-only, Supabase service-role key kept strictly server-side, strict CSP to reduce XSS exposure of the browser-stored Gemini key
- **Performance:** Paginated list endpoints, indexed queries on `org_id`/`user_id`/`expense_date`, cached FX rates, mobile-first performance budget (fast TTI on 4G)
- **Reliability:** DB migrations versioned, seed script for demo data
- **Observability:** Structured logging, basic error tracking (Sentry-tier)
- **Testing:** Unit tests for tool `execute()` functions (they're just async functions — easy to test in isolation), integration tests for approval workflow state machine
- **PWA:** passes installability criteria; offline fallback verified on core screens
- **SEO/Agents:** Lighthouse SEO score ≥95 on public pages; sitemap/robots/structured data validated

---

## 10. Roadmap / Milestones

### Phase 0 — Hackathon MVP (target: before Aug 31 deadline)
1. Angular SSR app scaffolded as a mobile-first PWA, single deployable, wired to Firebase App Hosting
2. Supabase project set up (Postgres + Storage), server routes only — no frontend Supabase access
3. Auth + single org + expense CRUD (manual entry only)
4. Settings screen: Gemini key entry (browser-stored) + model selector
5. 3–4 core WebMCP tools: `submit_expense`, `search_expenses`, `get_budget_status`, `generate_report` (with cancellation)
6. Declarative form tool for quick-add
7. Basic Copilot widget wired to Gemini function-calling (BYOK, client-side), visible tool-call trace
8. One cross-origin demo (Copilot on a second toy page)
9. Baseline SEO pass on public/landing pages (SSR, meta tags, sitemap)
10. Deployed on Firebase App Hosting + demo video/script

### Phase 1 — Depth
- Approval workflows + roles + state-gated `approve_expense` tool
- Multi-currency + FX — the embedded converter (§6.5) is advisory only and does **not** close this; the open work is live rates, a daily cache, and a historical rate lock at write time, all server-side
- Recurring expenses
- Analytics dashboard + forecasting

### Phase 2 — Polish
- Receipt OCR
- Notifications (email + in-app)
- Admin settings, audit log viewer, exportable reports
- Full accessibility pass, animations, empty/loading/error states everywhere

### Phase 3 — Copilot generalization
- Package the Copilot as a standalone npm/script package
- Docs site for embedding it on arbitrary WebMCP sites
- Public "try it on your own site" playground

---

## 11. Risks & Open Questions

- **Chrome flag dependency:** WebMCP is behind a flag / origin trial — demo must run on a WebMCP-enabled Chrome build; need a fallback recording for judges without it enabled.
- **BYOK friction:** requiring a Gemini key before the Copilot works adds a setup step for every new visitor/judge — make key entry fast, with a clear "get a free key here" link, and consider a short demo GIF as a fallback if a judge doesn't want to provide one.
- **Client-side key exposure:** storing the Gemini key in the browser means it's only as safe as the app's XSS posture — CSP and careful dependency hygiene matter more here than in a typical app.
- **Gemini model churn:** the model line-up (Gemini 3 Pro/Flash, 2.5 Flash, etc.) shifts over time and older models get retired — the model selector should be easy to update without a code change (e.g. a small config list) rather than hardcoded deep in the UI.
- **Angular SSR + Firebase App Hosting maturity:** confirm current support/limits for Angular SSR on Firebase App Hosting before committing — fall back to a lighter prerendering approach for public pages if full SSR proves friction-heavy under deadline pressure.
- **Cross-origin demo complexity:** iframe + permissions policy setup is fiddly — budget real time for this, it's also the most impressive part of the demo.
- **Scope creep:** the feature list in §6 is deliberately large — Phase 0 must be ruthlessly cut down to what's demoable in the time available.
- **Decision needed:** roll your own auth vs. use Supabase Auth server-side within `backend/` (still fronted by the backend's own routes, per the data boundary rule in §8.2).
- **Decision needed:** NestJS vs plain Express for `backend/` — NestJS gives more structure for RBAC/guards but has a steeper setup cost; either way, keep `backend/` fully independent of `frontend/`'s build.
- **Combined-deploy plumbing:** getting a distinct `frontend/` + `backend/` monorepo to build into a single Firebase App Hosting service (one process serving SSR pages and `/api/*` routes together) takes real setup — budget time for the build/deploy config itself, not just the app code.

---

## 12. Hackathon Submission Criteria (self-check)

- [ ] Public deployed URL
- [ ] README explains what's WebMCP-specific and how to test it (flag setup, extension link)
- [ ] Short demo video showing: manual tool use, agent-driven tool use, state-gated tool appearing/disappearing, cross-origin tool call, a cancelled long-running tool
- [ ] Source public with clear tool definitions highlighted
- [ ] Clear articulation of what's "new" — the portable Copilot widget, not just a single site's tools
