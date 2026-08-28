import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Button } from './button';

/**
 * Error state — Design Doc §3.6: actionable, and it never blames the user.
 *
 * The defaults are written to that rule: the subject of the sentence is the app
 * or the request, never "you". Callers overriding `heading`/`message` should
 * keep that. Technical detail is available but collapsed, so the primary read
 * stays "here is what to do next".
 *
 * ```html
 * <ui-error-state [detail]="err.message" (retry)="reload()" />
 * ```
 */
@Component({
  selector: 'ui-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col items-center justify-center rounded-xl border border-status-danger/30
             bg-surface px-6 py-10 text-center sm:py-12"
      role="alert"
    >
      <div
        class="mb-4 flex size-11 items-center justify-center rounded-full
               bg-status-danger/12 text-status-danger"
        aria-hidden="true"
      >
        <svg
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5" />
          <path d="M12 16h.01" />
        </svg>
      </div>

      <h3 class="text-base font-semibold text-body">{{ heading() }}</h3>
      <p class="mt-1.5 max-w-sm text-sm text-muted">{{ message() }}</p>

      <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
        @if (showRetry()) {
          <button uiButton variant="secondary" size="md" (click)="retry.emit()">
            {{ retryLabel() }}
          </button>
        }
        <ng-content select="[uiErrorAction]" />
      </div>

      @if (detail()) {
        <div class="mt-5 w-full max-w-lg text-left">
          <button
            uiButton
            variant="ghost"
            size="sm"
            [attr.aria-expanded]="detailOpen()"
            (click)="toggleDetail()"
          >
            {{ detailOpen() ? 'Hide details' : 'Show details' }}
          </button>
          @if (detailOpen()) {
            <pre
              class="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-card p-3
                     font-mono text-xs whitespace-pre-wrap text-muted"
              >{{ detail() }}</pre
            >
          }
        </div>
      }
    </div>
  `,
})
export class ErrorState {
  readonly heading = input('This didn’t load');
  readonly message = input(
    'The request didn’t come back. Nothing was changed — try again, or give it a moment.',
  );
  /** Raw error text. Collapsed by default; never the headline. */
  readonly detail = input<string | null>(null);
  readonly retryLabel = input('Try again');
  readonly showRetry = input(true);

  readonly retry = output<void>();

  protected readonly detailOpen = signal(false);

  protected toggleDetail(): void {
    this.detailOpen.update((open) => !open);
  }
}
