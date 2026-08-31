# Actuo

**AI-native expense intelligence, and a reference implementation of the
[WebMCP](https://github.com/webmachinelearning/webmcp) standard.**

Actuo is a multi-tenant expense management platform (Angular SSR + NestJS +
Supabase) where every meaningful user action is *also* a WebMCP tool. An AI agent
can drive the app through the same routes, the same auth and the same RBAC as a
person — and every call it makes is written to an audit log you can read.

The differentiated piece is the **Actuo Copilot**: a site-agnostic chat widget
that discovers tools through `document.modelContext`, reasons with the user's own
Gemini key entirely client-side, and shows every tool call as an expandable card.

---

## What is WebMCP-specific here

This is the part worth reviewing. PRD §7 is a coverage checklist and each row has
a concrete implementation:

| Aspect | Where |
|---|---|
| **Declarative API** — a tool derived from annotated HTML, with *no* `registerTool()` call anywhere | `frontend/src/app/pages/add-expense/add-expense.ts` |
| **Imperative `registerTool`** — five tools, each with its own registration lifetime | `frontend/src/app/webmcp/tool-registry.ts`, `frontend/src/app/tools/expense-tools.ts` |
| **JSON Schema inputs** — one definition used by the client *and* validated by the server | `shared/src/tools.ts` |
| **Dynamic / state-gated tools** — `approve_expense` registers only while you can actually approve something, and fires `toolchange` as that changes | `frontend/src/app/webmcp/tool-session.ts` |
| **Cancellation** — `generate_report` honours `AbortSignal`; the server abandons the job mid-flight, not just the client | `frontend/src/app/tools/expense-tools.ts`, `backend/src/reports/` |
| **Cross-origin tools** — the Copilot discovers and calls tools published by an unrelated site | `frontend/src/app/pages/agent/agent.ts`, `frontend/public/partner-demo/` |
| **Security annotations** — `readOnlyHint` on reads; `untrustedContentHint` where a result carries text a person wrote; mutating tools require in-chat confirmation before they run | `shared/src/tools.ts`, `frontend/src/app/copilot/copilot.ts` |

### The tools

| Tool | | |
|---|---|---|
| `search_expenses` | read-only | Search by text, status or date range |
| `get_budget_status` | read-only | Per-category budget, spend, remaining, utilization |
| `generate_report` | read-only | CSV for a date range — long-running, cancellable |
| `submit_expense` | **mutating** | Create an expense and submit it for approval |
| `approve_expense` | **mutating**, state-gated | Approve or reject — registered only when the queue is non-empty *and* you are an admin or owner |

Plus `add_expense_form`, which the browser derives from the annotated markup of
the Add Expense page.

### One design decision worth knowing

`getTools()` returns descriptors with **no execute handle**, and `executeTool()`
is a Chromium extension rather than part of the core spec. So the Copilot cannot
be built the obvious way. Instead a single `ToolRegistry` is the source of truth:
it publishes each tool to WebMCP so external browser agents see real tools, *and*
keeps the `execute` functions locally so the in-page Copilot calls them directly
— which works in every browser with no flag at all. `executeTool()` is used for
exactly one thing: cross-origin tools, the one path that genuinely needs it.

That is why **the app is fully usable without the Chrome flag**, and flag
dependence is confined to the cross-origin demo.

---

## Trying it

### 1. Run it

```bash
npm install           # npm workspaces — see CLAUDE.md for why not pnpm
npm run dev          # backend :3000, frontend :4200, partner demo :4201
```

Open http://localhost:4200 and sign in with a seeded account:

| | | |
|---|---|---|
| `priya@actuo.demo` | `Demo1234!` | owner — can approve |
| `arjun@actuo.demo` | `Demo1234!` | member — cannot |

The backend needs `backend/.env` (copy `backend/.env.example`) pointing at a
Supabase project with `supabase/migrations/` applied.

### 2. Give the Copilot a key

Settings → AI & Copilot, paste a [Google AI Studio](https://aistudio.google.com/apikey)
key, press **Test key**. The key is stored **only in your browser** and goes
straight to Google — it is never sent to, proxied by, or logged by Actuo's
servers. You can watch that in DevTools → Network: the key appears only in
requests to `generativelanguage.googleapis.com`.

### 3. Turn on WebMCP (optional)

Everything above works without this. To see Actuo's tools as *real* WebMCP tools
that an external agent can drive, enable in Chrome 149+:

```
chrome://flags/#enable-webmcp-testing     ("Enables the WebMCP API")
chrome://flags/#devtools-webmcp-support
```

or launch Chrome with `--enable-blink-features=WebMCP`. Then visit **/agent**,
which shows what this page publishes, what it can reach on other origins, and a
live log of every tool call.

### What to look at

- **State-gated tool.** Sign in as `priya`. `approve_expense` is in
  `document.modelContext.getTools()`. Sign in as `arjun` instead and it is gone,
  even though the approval queue is not empty — and the API returns 403 either
  way, because the gate is UX and the guard is the boundary.
- **Cross-origin.** `/agent` embeds Pageturner Books from `localhost:4201`, a
  page that knows nothing about Actuo. Ask the Copilot what *The Overstory*
  costs; the tool card carries a `via localhost:4201` badge.
- **Cancellation.** Ask for a report, then press **Stop**. The UI reacts
  immediately and the server abandons the job.
- **Audit trail.** Settings has two panels and they are not the same thing:
  **Tool calls** is every WebMCP invocation (filter it to Agent, then Human);
  **Change history** is every state change, including ones made by clicking.
  Approve an expense from the Expenses page and it appears in the second, not
  the first.
- **Humans and agents share one permission model.** Sign in as `arjun` and the
  approve controls are gone from the Expenses page — and `POST
  /api/expenses/:id/approve` still returns 403 if you call it directly. Sign in
  as `priya` and try to approve an expense she filed herself: no button, and the
  API refuses that too.

---

## Layout

```
frontend/   Angular 21 — SSR, zoneless, standalone components, Signals, Tailwind v4
backend/    NestJS 12 (ESM) — auth, RBAC, business logic, all Supabase access
shared/     @actuo/shared — DTOs, domain types, WebMCP tool JSON Schemas
docs/       PRD, design doc, init guide
```

Two codebases, **one deployable**: `server.mjs` at the repository root runs a
single Node process in which Nest owns `/api/*` and the Angular SSR handler takes
everything else. It installs as a PWA — manifest, service worker, offline
banner — and the worker deliberately caches **no** `/api` response, because
stale money is worse than a spinner.

Boundaries that are not negotiable (see `CLAUDE.md` for the full list): the
frontend never talks to Supabase, the Gemini key never reaches our servers, and
roles are enforced server-side on every request.

```bash
npm test          # shared + backend unit + frontend
npm run test:e2e  # backend e2e — a separate config, not included above
npm run build     # shared -> backend -> frontend, then the SEO origin stamp
```

`.github/workflows/ci.yml` runs exactly that gate on every push. It needs no
secrets: `EnvService` raises on a missing variable at *call* time rather than
import time, so the app boots and runs its e2e suite without credentials.

---

## Deploying

The target is Firebase App Hosting, but `server.mjs` is a plain Node server, so
any host that can run `npm ci && npm run build && npm start` will do.

Check it locally first — this is the whole deploy in one command:

```bash
npm run build && node server.mjs        # :8080

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:8080/           # 200 text/html
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:8080/api/health  # 200 application/json
curl -s localhost:8080/api/nope                                                     # JSON 404, not the app shell
curl -s localhost:8080/ | grep -o 'ng-server-context="[^"]*"'                        # must print something
```

That last one matters more than it looks — see *Allowed hosts* below.

### Firebase App Hosting

`apphosting.yaml` and `firebase.json` are committed. Both the build and the run
command are stated outright rather than left to framework detection, because this
repository is an npm workspace with no framework at its root.

```bash
firebase login
firebase apphosting:backends:create --project <PROJECT_ID> --location <REGION>
#   root directory: /        (the repository root — see below)

# Each prompts for the value and grants the backend access:
firebase apphosting:secrets:set actuo-supabase-service-role-key
firebase apphosting:secrets:set actuo-jwt-access-secret
firebase apphosting:secrets:set actuo-jwt-refresh-secret

firebase deploy --only apphosting        # deploys from this local checkout
```

Set `SUPABASE_URL` in `apphosting.yaml` to your own project before deploying.

**Root directory must be `/`.** App Hosting looks for the lockfile at the root
directory it is given, so keeping it at the repository root puts
`package-lock.json` where the installer expects it
([firebase-tools#7478](https://github.com/firebase/firebase-tools/issues/7478)
covers the subdirectory case).

**This project is on npm because App Hosting could not build it with pnpm.**
`pnpm install` fails inside the buildpack with `Cannot convert undefined or null
to object` — [firebase-tools#10435](https://github.com/firebase/firebase-tools/issues/10435),
filed for pnpm monorepos and closed as not planned. It does not reproduce
locally. If the npm build hits a comparable wall, nothing needs rewriting:
`node server.mjs` is a plain Node server and runs on Cloud Run, Render or Fly
unchanged.

### Set `PUBLIC_ORIGIN` too

The public pages are prerendered, so absolute URLs — the sitemap's `<loc>`,
`og:image`, `canonical` — have to be decided at build time. `index.html`,
`sitemap.xml` and `robots.txt` carry a `__PUBLIC_ORIGIN__` sentinel that
`scripts/stamp-seo.mjs` replaces as the last step of `npm run build`. Unset,
everything stays root-relative and valid; set, it becomes absolute.

```bash
PUBLIC_ORIGIN=https://your-host npm run build
grep -o '<loc>[^<]*</loc>' frontend/dist/frontend/browser/sitemap.xml
```

### Allowed hosts — the one that fails silently

Angular 21 refuses to server-render a request whose `Host` header is not on an
allowlist (SSRF protection). Off the list it does **not** error: it quietly falls
back to client-side rendering, which throws away the SSR and structured-data work
on the public pages. `NG_ALLOWED_HOSTS` in `apphosting.yaml` is that list, and it
*replaces* the build-time list in `angular.json` rather than adding to it.

After any deploy, confirm the HTML for `/` contains `ng-server-context`. If it
does not, `NG_ALLOWED_HOSTS` does not match your hostname.

### The cross-origin demo on a deployed URL

The partner page ships inside the app, so on a deploy it is same-origin — which
proves nothing about *cross*-origin tools, and `/agent` says exactly that rather
than showing an empty list. To make the demo real on a public URL, host
`frontend/public/partner-demo/` somewhere else and point `PARTNER_DEMO_ORIGIN` at
it.

---

## Status

`Progress.md` tracks every PRD feature against what is actually implemented,
including a `DEAD` status for code that exists and passes tests but has no caller.
It is deliberately evidence-based rather than aspirational; start there.

Built for a hackathon deadline. `CLAUDE.md` carries the architectural rules and
the non-obvious constraints worth knowing before changing anything.
