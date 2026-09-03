# Actuo — Design Document
### Design Philosophy, Visual Identity & UX Specification

**Version:** 0.1 (Draft)
**Companion to:** Actuo-PRD.md

---

## 1. Design Philosophy

Actuo sits at an unusual intersection: it's a serious financial tool (needs to feel trustworthy, precise, calm) *and* an agentic product (needs to feel alive, transparent, a little futuristic). The design has to earn trust on both fronts at once.

Three principles guide every screen:

1. **Legible confidence.** Money data has to be scannable at a glance — clear type hierarchy, generous whitespace, no decorative clutter competing with numbers. This is not a "fun" consumer app; it's precise, but not cold.
2. **Visible agency.** Every time the Copilot acts, the user sees exactly what happened — which tool ran, what it changed, and a way to undo. Nothing an agent does should ever feel like it happened "behind the UI." This is the core trust mechanic of the whole product, and it should be a genuine visual signature, not a debug log bolted on the side.
3. **Warm precision.** Fintech products default to sterile blue-and-white SaaS templates. Actuo should feel distinct — a confident, saturated accent palette against a deep neutral base, expressive data visualization, and small delight moments (micro-animations on success states, a Copilot that has a bit of personality) — without ever undermining the "I trust this with my money" feeling.

---

## 2. Visual Identity

### 2.1 Theme concept: "Aurora Ledger"

A dark-first, high-contrast interface with a signature gradient accent (aurora-like teal → violet → amber) used sparingly as a highlight system — for active states, the Copilot's presence, charts, and key CTAs — against a deep charcoal/navy base. This avoids the generic "corporate blue" fintech look while staying credible for financial data. Light mode is a first-class second theme (many people won't want dark mode for a finance app during the day), not an afterthought.

**Why dark-first:** it makes the Copilot widget's glow/gradient accent genuinely eye-catching (gradients read much more vivid on dark backgrounds), and it differentiates Actuo visually from the sea of white-background expense tools.

### 2.2 Color System (Tailwind custom theme)

Extend Tailwind's config rather than fighting the defaults:

```js
// tailwind.config.js (excerpt)
theme: {
  extend: {
    colors: {
      base: {
        950: '#0A0E14',   // app background (dark)
        900: '#10141C',   // surface
        800: '#171C26',   // card
        700: '#232936',   // border/divider
        100: '#F4F6F9',   // light mode background
      },
      brand: {
        teal:   '#2DD4BF',
        violet: '#8B5CF6',
        amber:  '#F59E0B',
        rose:   '#FB7185',
      },
      ink: {
        DEFAULT: '#E6E9EF', // primary text on dark
        muted:   '#9AA3B2',
        inverted:'#10141C', // primary text on light
      },
      status: {
        success: '#34D399',
        warning: '#FBBF24',
        danger:  '#F87171',
        info:    '#60A5FA',
      }
    },
    backgroundImage: {
      'aurora': 'linear-gradient(120deg, #2DD4BF 0%, #8B5CF6 55%, #F59E0B 100%)',
    },
    boxShadow: {
      'glow-teal': '0 0 24px 0 rgba(45,212,191,0.35)',
      'glow-violet': '0 0 24px 0 rgba(139,92,246,0.35)',
    },
  }
}
```

**Usage rules:**
- The `aurora` gradient is reserved for: the Copilot avatar/orb, the Copilot's "thinking" state, primary onboarding moments, and chart accent lines. It should never appear on more than one element at a time in a given viewport — scarcity is what keeps it special.
- Category colors (for expense tags/charts) draw from a fixed 8-color categorical palette derived from `brand.*` + `status.*` so charts stay legible and consistent across the app.
- Semantic color (`status.*`) is reserved strictly for state (success/warning/danger/info) — never used decoratively, so users can trust it as a signal.

### 2.3 Typography

- **Display/headings:** A geometric sans with some character — e.g. `Cabinet Grotesk` or `General Sans` (both free, distinctive, not another Inter clone) for headlines and the Copilot's chat bubbles.
- **Body/UI:** `Inter` or `Geist` for all data-dense UI (tables, forms, numbers) — proven legibility at small sizes.
- **Numerals:** enable tabular figures (`font-variant-numeric: tabular-nums`) everywhere money is displayed, so columns of amounts align.
- **Scale:** Tailwind's default type scale is fine; just ensure a clear jump between data labels (`text-xs`, muted) and data values (`text-lg`/`text-2xl`, `ink` or `brand` color, tabular nums).

### 2.4 Iconography & Illustration
- Line-style icon set (Lucide, which is already available in your React toolchain and has an Angular-friendly equivalent) — consistent stroke width, no mixed icon styles.
- Avoid stock illustration. Empty states use simple, on-brand line art or just well-written copy + a single accent shape — cheaper to build well than to build mediocre illustrations.

---

## 3. UX Principles

### 3.1 Information architecture (mobile-first)

Actuo is designed for the phone viewport first, then scaled up — not the other way around.

- **Mobile (default design target):** bottom tab bar — Dashboard · Expenses · Add (center, prominent) · Budgets · More (Approvals/Analytics/Settings tucked behind it). Copilot is a floating orb above the tab bar, opening as a full-screen sheet on mobile rather than a small panel, since a cramped chat panel is unusable on a small screen.
- **Tablet/desktop (progressive enhancement):** the bottom tab bar becomes a collapsible left rail — Dashboard · Expenses · Budgets · Approvals · Analytics · Settings — and the Copilot reverts to a floating panel, bottom-right, never modal-blocking.
- **Persistent global elements:** top bar with org switcher + notification bell (compact on mobile, full on desktop).
- **Install prompt:** a lightweight, dismissible "Install Actuo" prompt (native `beforeinstallprompt` on Android, guided instructions on iOS) surfaced after a user has completed a meaningful action (e.g. their first expense) — not on first load, which reads as pushy.

### 3.2 The Copilot interaction pattern (the signature UX)

This is the part worth designing most carefully, since it's the whole point of the project:

1. **Idle state:** small aurora-gradient orb, bottom-right, subtle breathing animation.
2. **Opened state:** slide-up panel, chat input at bottom, conversation above.
3. **When the agent calls a tool**, render an inline **"Tool Call Card"** in the chat stream — not just text output:
   - Tool name in monospace-ish badge (`search_expenses`)
   - Collapsed by default: one-line human-readable summary ("Searched expenses: last 30 days, category = Travel")
   - Expandable to show raw input JSON + result
   - A small colored dot indicating `readOnlyHint` (blue = safe/read-only) vs a mutating action (amber = changed something)
4. **Sensitive actions** (submit/delete/approve) trigger a native confirmation step **inside the chat itself** — a card with "Confirm" / "Cancel" buttons — never a silent execution.
5. **Cross-origin calls** get a distinct badge showing the origin the tool came from (e.g. "via cambiaro.programmersingh.dev") — this is a great subtle way to make the cross-origin feature *visible* to a judge/demo audience instead of invisible plumbing.
6. **Cancellable actions** (e.g. report generation) show a progress state with a visible "Stop" button that calls `AbortSignal.abort()` — and the UI should visibly react within ~100ms so cancellation feels real, not decorative.

This tool-call-card pattern effectively turns the Copilot into a live changelog of agent behavior, which is both good UX and a built-in demo script.

### 3.3 Core screens

- **Dashboard:** hero summary cards (this month spend, budget remaining, pending approvals) using the aurora gradient sparingly on the "spend pace" card; trend chart below; recent activity feed.
- **Add Expense (declarative form):** deliberately simple, plain HTML form styled with Tailwind — this is the one screen that's WebMCP-declarative rather than JS-driven, so keep it visually clean to reinforce that it's "just a form."
- **Expenses table:** dense, sortable, filterable; row-level status pills (draft/submitted/approved/rejected/reimbursed) using `status.*` colors only.
- **Budgets:** progress bars per category with color shifting from `status.success` → `status.warning` → `status.danger` as usage climbs.
- **Approvals (admin):** queue view, one-click approve/reject, comment thread.
- **Analytics:** category breakdown (donut using the categorical palette), trend line (aurora gradient stroke), forecast line as a dashed projection.
- **Settings/Admin:** org info, members/roles table, category manager, audit log (searchable, timestamped, filterable by "human" vs "agent" actor — reusing the `tool_call_log` table from the PRD).
- **Settings → AI & Copilot (BYOK):** its own clearly-labeled section — Gemini API key field (masked, with show/hide toggle), a model selector dropdown (Gemini models only), a "Test key" button giving immediate pass/fail feedback, a "Clear key" action, and a short, plain-language trust line: *"Your key is stored only in this browser and is never sent to Actuo's servers."* This screen carries real trust weight — treat its copy and layout with the same care as a payment form, not as a throwaway settings row.

### 3.4 Motion
- Keep motion purposeful, not decorative: state transitions (tool executing, budget threshold crossed, approval granted) get a brief (150–250ms) animation; nothing else does.
- The Copilot orb's idle "breathing" animation is the one place a longer, ambient animation is appropriate — it signals "I'm here and listening" without being distracting.

### 3.5 Accessibility
- Maintain WCAG AA contrast in both themes — verify the aurora gradient's midpoint (violet) against dark background text overlays specifically, gradients often fail contrast checks at certain stops.
- All Copilot tool-call cards must be screen-reader friendly: the collapsed summary text should be the accessible name, not just an icon+badge.
- Full keyboard navigation for the Copilot panel (open/close, focus trap, escape to close).
- Respect `prefers-reduced-motion` — disable the orb breathing animation and card transitions accordingly.

### 3.6 Empty / loading / error states
- Every list/table needs a designed empty state (not just "No data") — short, specific copy tied to the action that would fill it ("No expenses yet — add one, or ask the Copilot to log something for you").
- Loading states use skeleton screens, not spinners, for anything list-shaped.
- Error states are actionable (retry button) and never blame the user.

### 3.7 PWA & offline states
- A dedicated **offline banner** (not a browser default) when connectivity drops — calm, informative, doesn't block the UI.
- Cached shell + last-fetched data render immediately offline; anything requiring a live network call (Copilot, FX rates) shows a clear "needs connection" state rather than hanging.
- Touch targets sized for one-handed mobile use (minimum ~44px) throughout, especially in the bottom tab bar and Add Expense flow.
- No key UI element should sit under the mobile safe-area/notch or behind the install prompt banner.

---

## 4. Component Approach

- Build a small internal design-system layer (Angular standalone components) early: `Button`, `Card`, `Badge/Pill`, `Input`, `ToolCallCard`, `StatCard`, `ProgressBar` — everything else composes from these.
- Use Tailwind utility classes directly in templates rather than heavy `@apply` abstraction, but centralize the theme tokens (§2.2) in `tailwind.config.js` so the palette is the single source of truth.
- Charts: a lightweight library (e.g. Chart.js or a thin D3 wrapper) themed with the exact palette from §2.2 — never default chart-library colors.

---

## 5. Brand Voice (Copilot personality)

The Copilot should sound like a sharp, calm colleague — not a chirpy assistant and not a dry CLI. Confirmations are direct ("This will submit a ₹1,200 expense for approval — confirm?"), not cutesy. Errors are honest and specific ("I couldn't find a category called 'Food' — did you mean 'Dining'?"). This tone consistency matters more for trust here than in a typical chatbot, because it's handling money.

---

## 6. Design Deliverables Checklist

- [ ] Tailwind theme config finalized (colors, fonts, shadows)
- [ ] Component library: 10–12 base components in Storybook or a simple showcase route
- [ ] Dashboard, Expenses, Add Expense, Budgets, Approvals, Analytics, Settings — high-fidelity screens (Figma or directly in code)
- [ ] Copilot panel + Tool Call Card — this is the highest-priority screen to nail, both functionally and visually
- [ ] Dark + light theme parity pass
- [ ] Empty/loading/error state pass across all list views
- [ ] Accessibility audit (contrast, keyboard, reduced motion)
