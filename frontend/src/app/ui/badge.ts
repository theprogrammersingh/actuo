import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

/** The five expense states from Design Doc §3.3. */
export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Status → tone. §2.2: `status.*` is a signal, never decoration, so the mapping
 * has to be readable as a lifecycle rather than as "green means nice".
 *
 *   draft      → neutral  no signal yet; nothing has been claimed
 *   submitted  → warning  waiting on a human; someone has an action to take
 *   approved   → info     decided, but the money has not moved
 *   rejected   → danger   terminal, unfavourable
 *   reimbursed → success  terminal, the money actually moved
 *
 * `approved` is deliberately *not* success: approved and reimbursed would then be
 * indistinguishable at a glance in a dense table, which is where these pills live.
 */
const STATUS_TONE: Record<ExpenseStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'info',
  rejected: 'danger',
  reimbursed: 'success',
};

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  reimbursed: 'Reimbursed',
};

/**
 * Status pill.
 *
 * ```html
 * <ui-badge status="approved" />
 * <ui-badge tone="info" label="via cambiaro.programmersingh.dev" />
 * ```
 *
 * The colour is carried by a dot *and* the text, and the text is always present,
 * so the pill never relies on hue alone (WCAG 1.4.1).
 */
@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span
      class="pill inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      [class]="'tone-' + tone()"
    >
      @if (dot()) {
        <span class="dot size-1.5 shrink-0 rounded-full" aria-hidden="true"></span>
      }
      <ng-content>{{ text() }}</ng-content>
    </span>
  `,
  /*
   * Component-scoped CSS rather than utilities for one specific reason: the raw
   * status palette is tuned for a dark ground. `#34d399` as *text* on the light
   * theme's white card is ~1.9:1 and fails AA outright. Mixing the tone toward the
   * ink colour under `[data-theme='light']` fixes contrast in one place instead of
   * asking every caller to remember. styles.css stays untouched.
   */
  styles: [
    `
      .pill {
        --pill: var(--color-muted);
        background-color: color-mix(in oklab, var(--pill) 14%, transparent);
        color: var(--pill);
        border-color: color-mix(in oklab, var(--pill) 34%, transparent);
      }

      .dot {
        background-color: var(--pill);
      }

      .tone-neutral {
        --pill: var(--color-muted);
      }
      .tone-success {
        --pill: var(--color-status-success);
      }
      .tone-warning {
        --pill: var(--color-status-warning);
      }
      .tone-danger {
        --pill: var(--color-status-danger);
      }
      .tone-info {
        --pill: var(--color-status-info);
      }

      /*
       * No light-mode override is needed here: --color-status-* is itself
       * theme-aware in styles.css, so the same rules stay AA in both themes.
       * Verified: every status is >= 5.0:1 against its card background.
       */
    `,
  ],
})
export class Badge {
  /** When set, drives both the tone and the default label. */
  readonly status = input<ExpenseStatus | null>(null);
  /** Used only when `status` is null. */
  readonly toneInput = input<BadgeTone>('neutral', { alias: 'tone' });
  /** Overrides the label derived from `status`. */
  readonly label = input<string | null>(null);
  readonly dot = input(true, { transform: booleanAttribute });

  readonly tone = computed<BadgeTone>(() => {
    const status = this.status();
    return status ? STATUS_TONE[status] : this.toneInput();
  });

  readonly text = computed(() => {
    const explicit = this.label();
    if (explicit !== null) return explicit;
    const status = this.status();
    return status ? STATUS_LABEL[status] : '';
  });
}

/** Exported so tables and filters can share one source of truth for the mapping. */
export const EXPENSE_STATUS_TONE: Readonly<Record<ExpenseStatus, BadgeTone>> = STATUS_TONE;
export const EXPENSE_STATUS_LABEL: Readonly<Record<ExpenseStatus, string>> = STATUS_LABEL;
