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
| **Security annotations** — `readOnlyHint` on reads; mutating tools require in-chat confirmation before they run | `shared/src/tools.ts`, `frontend/src/app/copilot/copilot.ts` |

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
pnpm install          # pnpm, not npm — see CONTRIBUTING notes in CLAUDE.md
pnpm run dev          # backend :3000, frontend :4200, partner demo :4201
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
- **Audit trail.** Settings → Audit log, filtered to Agent, then Human.

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
everything else.

Boundaries that are not negotiable (see `CLAUDE.md` for the full list): the
frontend never talks to Supabase, the Gemini key never reaches our servers, and
roles are enforced server-side on every request.

```bash
pnpm test          # shared + backend unit + frontend
pnpm run test:e2e  # backend e2e — a separate config, not included above
pnpm run build     # shared -> backend -> frontend, in that order
```

---

## Deploying

The target is Firebase App Hosting, but `server.mjs` is a plain Node server, so
any host that can run `pnpm install && pnpm run build && pnpm start` will do.

Check it locally first — this is the whole deploy in one command:

```bash
pnpm run build && node server.mjs        # :8080

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:8080/           # 200 text/html
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:8080/api/health  # 200 application/json
curl -s localhost:8080/api/nope                                                     # JSON 404, not the app shell
curl -s localhost:8080/ | grep -o 'ng-server-context="[^"]*"'                        # must print something
```

That last one matters more than it looks — see *Allowed hosts* below.

### Firebase App Hosting

`apphosting.yaml` and `firebase.json` are committed. Both the build and the run
command are stated outright rather than left to framework detection, because this
repository is a pnpm workspace with no framework at its root.

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

**Root directory must be `/`.** Firebase App Hosting has a known open issue with
pnpm workspaces in a *subdirectory* ([firebase-tools#7478](https://github.com/firebase/firebase-tools/issues/7478),
`lockfile not found`). Keeping the root directory at the repository root puts
`pnpm-workspace.yaml` and `pnpm-lock.yaml` where the installer looks. If the
build fails there anyway, nothing needs rewriting: `node server.mjs` runs on
Cloud Run, Render or Fly unchanged.

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
