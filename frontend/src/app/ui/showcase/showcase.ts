import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { ThemeService } from '../../core/theme/theme-service';
import { Badge, type ExpenseStatus } from '../badge';
import { Button, type ButtonSize, type ButtonVariant } from '../button';
import { Card } from '../card';
import { EmptyState } from '../empty-state';
import { ErrorState } from '../error-state';
import { Input } from '../input';
import { ProgressBar } from '../progress-bar';
import { Skeleton } from '../skeleton';
import { StatCard } from '../stat-card';

/**
 * Design Doc §6 — "component library in a simple showcase route".
 *
 * Every component in every state, on one page, with a theme switch. This is how
 * the dark/light parity pass gets eyeballed, so it deliberately shows the states
 * that are easy to get wrong: disabled, loading, error, over-budget, empty.
 *
 * Not registered in `app.routes.ts` on purpose — routing is owned elsewhere.
 * Wire it up with:
 * `{ path: 'ui', loadComponent: () => import('./ui/showcase/showcase').then(m => m.Showcase) }`
 *
 * Aurora scarcity (§2.2) is honoured here too: there is exactly **one** aurora
 * element on this page, the hero "Spend pace" stat card.
 */
@Component({
  selector: 'app-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Input,
    ProgressBar,
    Skeleton,
    StatCard,
  ],
  host: { class: 'block min-h-dvh bg-canvas text-body' },
  template: `
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header class="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-semibold sm:text-3xl">Aurora Ledger</h1>
          <p class="mt-1 text-sm text-muted">
            Actuo's design-system layer — every component, every state.
          </p>
        </div>

        <button
          uiButton
          variant="secondary"
          size="md"
          [attr.aria-label]="'Switch to ' + (theme.isDark() ? 'light' : 'dark') + ' theme'"
          (click)="theme.toggle()"
        >
          <span aria-hidden="true">{{ theme.isDark() ? '☾' : '☀' }}</span>
          {{ theme.isDark() ? 'Dark' : 'Light' }}
        </button>
      </header>

      <!-- Buttons ------------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-button">
        <h2 id="sec-button" class="mb-1 text-lg font-semibold">Button</h2>
        <p class="mb-4 text-sm text-muted">
          Attribute selector on a native <code class="font-mono text-xs">&lt;button&gt;</code>.
          Every size clears the 44px touch target.
        </p>

        <ui-card>
          <div class="space-y-5">
            @for (variant of variants; track variant) {
              <div class="flex flex-wrap items-center gap-3">
                <span class="w-20 shrink-0 text-xs text-muted">{{ variant }}</span>
                @for (size of sizes; track size) {
                  <button uiButton [variant]="variant" [size]="size">{{ size }}</button>
                }
                <button uiButton [variant]="variant" [disabled]="true">disabled</button>
                <button uiButton [variant]="variant" [loading]="true">saving</button>
              </div>
            }
            <div>
              <span class="mb-2 block text-xs text-muted">block</span>
              <button uiButton variant="primary" [block]="true">Add expense</button>
            </div>
          </div>
        </ui-card>
      </section>

      <!-- Badge --------------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-badge">
        <h2 id="sec-badge" class="mb-1 text-lg font-semibold">Badge</h2>
        <p class="mb-4 text-sm text-muted">
          The five expense states. <code class="font-mono text-xs">status.*</code> signals state
          only — approved is <em>info</em>, not success, so it stays distinguishable from
          reimbursed at a glance.
        </p>

        <ui-card>
          <div class="flex flex-wrap items-center gap-2">
            @for (status of statuses; track status) {
              <ui-badge [status]="status" />
            }
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <ui-badge tone="info" label="via partner-demo.app" />
            <ui-badge tone="neutral" label="read-only" />
            <ui-badge status="approved" [dot]="false" />
          </div>
        </ui-card>
      </section>

      <!-- Stat cards ---------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-stat">
        <h2 id="sec-stat" class="mb-1 text-lg font-semibold">StatCard</h2>
        <p class="mb-4 text-sm text-muted">
          Tabular numerals throughout. Exactly one aurora card per viewport — the hero.
        </p>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ui-stat-card label="Spend pace" value="₹1,24,500" hint="On track for the month" aurora />
          <ui-stat-card
            label="Budget remaining"
            value="₹48,200"
            [delta]="-4.2"
            deltaLabel="vs last month"
            deltaTone="positive"
          />
          <ui-stat-card label="Pending approvals" value="7" [money]="false" [delta]="12" />
        </div>
      </section>

      <!-- Progress ------------------------------------------------------ -->
      <section class="mb-12" aria-labelledby="sec-progress">
        <h2 id="sec-progress" class="mb-1 text-lg font-semibold">ProgressBar</h2>
        <p class="mb-4 text-sm text-muted">
          success → warning → danger as utilisation climbs past 75% and 90%.
        </p>

        <ui-card>
          <div class="space-y-5">
            <ui-progress-bar label="Dining (42%)" [value]="42" [max]="100" />
            <ui-progress-bar label="Travel (78%)" [value]="78" [max]="100" />
            <ui-progress-bar label="Software (94%)" [value]="94" [max]="100" />
            <ui-progress-bar label="Events (118%)" [value]="118" [max]="100" />
            <ui-progress-bar label="Small variant" [value]="60" size="sm" />
            <ui-progress-bar ariaLabel="Report generation" [value]="35" tone="info" />
          </div>
        </ui-card>
      </section>

      <!-- Inputs -------------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-input">
        <h2 id="sec-input" class="mb-1 text-lg font-semibold">Input</h2>
        <p class="mb-4 text-sm text-muted">
          Two-way <code class="font-mono text-xs">[(value)]</code> or reactive forms. The masked
          variant is what the BYOK Gemini key field uses.
        </p>

        <ui-card>
          <div class="grid gap-5 sm:grid-cols-2">
            <ui-input label="Merchant" placeholder="Blue Tokai" [(value)]="merchant" />
            <ui-input
              label="Amount"
              type="number"
              inputmode="decimal"
              hint="Enter the amount in INR."
              [(value)]="amount"
            />
            <ui-input
              label="Category"
              error="Pick a category before submitting."
              [(value)]="category"
            />
            <ui-input label="Locked field" [disabled]="true" value="Cannot edit" />

            <form [formGroup]="form" class="sm:col-span-2">
              <ui-input
                label="Gemini API key"
                type="password"
                autocomplete="off"
                formControlName="geminiKey"
                hint="Stored only in this browser. Never sent to Actuo's servers."
              />
            </form>
          </div>

          <p class="mt-4 text-xs text-muted">
            merchant = <span class="font-mono">{{ merchant() || '—' }}</span> · key length =
            <span class="font-mono tabular">{{ form.controls.geminiKey.value?.length ?? 0 }}</span>
          </p>
        </ui-card>
      </section>

      <!-- Card ---------------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-card">
        <h2 id="sec-card" class="mb-1 text-lg font-semibold">Card</h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <ui-card padding="sm">
            <p class="text-sm">padding="sm"</p>
          </ui-card>
          <ui-card>
            <p class="text-sm">padding="md" (default)</p>
          </ui-card>
          <ui-card padding="lg" [interactive]="true">
            <p class="text-sm">interactive</p>
          </ui-card>
        </div>
      </section>

      <!-- Skeleton ------------------------------------------------------ -->
      <section class="mb-12" aria-labelledby="sec-skeleton">
        <h2 id="sec-skeleton" class="mb-1 text-lg font-semibold">Skeleton</h2>
        <p class="mb-4 text-sm text-muted">Skeletons, not spinners, for anything list-shaped.</p>

        <div class="grid gap-4 lg:grid-cols-2">
          <ui-card>
            <p class="mb-3 text-xs text-muted">shape="list"</p>
            <ui-skeleton shape="list" [lines]="3" label="Loading expenses" />
          </ui-card>
          <ui-card>
            <p class="mb-3 text-xs text-muted">shape="text"</p>
            <ui-skeleton shape="text" [lines]="4" label="Loading summary" />
          </ui-card>
          <div>
            <p class="mb-3 text-xs text-muted">shape="table"</p>
            <ui-skeleton shape="table" [rows]="4" [columns]="5" label="Loading expense table" />
          </div>
          <div>
            <p class="mb-3 text-xs text-muted">shape="card"</p>
            <ui-skeleton shape="card" label="Loading summary card" />
          </div>
        </div>
      </section>

      <!-- Empty / error ------------------------------------------------- -->
      <section class="mb-12" aria-labelledby="sec-states">
        <h2 id="sec-states" class="mb-1 text-lg font-semibold">Empty &amp; error states</h2>
        <p class="mb-4 text-sm text-muted">
          Specific copy tied to the action that would fill the view. Errors are actionable and
          never blame the user.
        </p>

        <div class="grid gap-4 lg:grid-cols-2">
          <ui-empty-state
            heading="No expenses yet"
            message="Add one, or ask the Copilot to log something for you."
          >
            <button uiButton uiEmptyAction variant="primary" size="md">Add expense</button>
            <button uiButton uiEmptyAction variant="ghost" size="md">Ask the Copilot</button>
          </ui-empty-state>

          <ui-error-state
            [detail]="'GET /api/expenses — 503 Service Unavailable'"
            (retry)="retries.set(retries() + 1)"
          />
        </div>

        <p class="mt-3 text-xs text-muted">
          retry fired <span class="tabular font-mono">{{ retries() }}</span> ×
        </p>
      </section>
    </div>
  `,
})
export class Showcase {
  protected readonly theme = inject(ThemeService);

  protected readonly variants: readonly ButtonVariant[] = [
    'primary',
    'secondary',
    'ghost',
    'danger',
  ];
  protected readonly sizes: readonly ButtonSize[] = ['sm', 'md', 'lg'];
  protected readonly statuses: readonly ExpenseStatus[] = [
    'draft',
    'submitted',
    'approved',
    'rejected',
    'reimbursed',
  ];

  protected readonly merchant = signal('');
  protected readonly amount = signal('');
  protected readonly category = signal('');
  protected readonly retries = signal(0);

  /** Proves the Input works as a ControlValueAccessor, which the BYOK form needs. */
  protected readonly form = new FormGroup({
    geminiKey: new FormControl(''),
  });
}
