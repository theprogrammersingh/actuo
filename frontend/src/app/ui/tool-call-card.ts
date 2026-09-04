import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { Badge } from './badge';

export type ToolCallState = 'running' | 'awaiting-confirmation' | 'done' | 'error' | 'cancelled';

/**
 * The Copilot's Tool Call Card — Design Doc §3.2, the signature UX of the whole
 * product.
 *
 * The trust mechanic is "visible agency" (§1.2): an agent must never appear to
 * change something behind the UI. So every tool call renders as a card in the
 * chat stream showing which tool ran, a human-readable summary of what it did,
 * and the raw input/result on demand.
 *
 * Accessibility (§3.5): the collapsed one-line summary is the accessible name of
 * the expander — not an icon plus a badge — so a screen-reader user hears what
 * happened, not "button, expand".
 */
@Component({
  selector: 'ui-tool-call-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge],
  host: { class: 'block' },
  template: `
    <article
      class="rounded-lg border border-line bg-card text-sm"
      [class.border-status-warning]="state() === 'awaiting-confirmation'"
    >
      <div class="flex items-start gap-2.5 p-3">
        <!--
          §3.2.3: a dot distinguishes a read-only call from one that changed
          something. Colour alone is never the signal — the title attribute and
          the visually-hidden text carry it too (WCAG 1.4.1).
        -->
        <span
          class="mt-1.5 size-2 shrink-0 rounded-full"
          [class]="mutates() ? 'bg-status-warning' : 'bg-status-info'"
          [title]="mutates() ? 'Changes data' : 'Read-only'"
          aria-hidden="true"
        ></span>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <code class="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-body">{{
              name()
            }}</code>

            <span class="sr-only">{{ mutates() ? 'Changes data.' : 'Read-only.' }}</span>

            <!--
              §3.2.5: surfacing the origin is what makes the cross-origin
              capability visible to a demo audience rather than invisible plumbing.
            -->
            @if (origin(); as toolOrigin) {
              <ui-badge tone="info" [label]="'via ' + toolOrigin" />
            }

            <!--
              §7 security annotations. The result carries text somebody typed —
              a merchant name, a note, a book title from another origin — which
              the model then reads. Saying so on the card is what turns the
              annotation from a declared field into something a viewer can see.
            -->
            @if (untrusted()) {
              <ui-badge tone="warning" label="Untrusted text" />
            }

            @switch (state()) {
              @case ('running') {
                <ui-badge tone="info" label="Running…" />
              }
              @case ('awaiting-confirmation') {
                <ui-badge tone="warning" label="Needs confirmation" />
              }
              @case ('error') {
                <ui-badge tone="danger" label="Failed" />
              }
              @case ('cancelled') {
                <ui-badge tone="neutral" label="Cancelled" />
              }
              @default {
                @if (durationMs(); as ms) {
                  <span class="text-xs text-muted tabular">{{ ms }}ms</span>
                }
              }
            }
          </div>

          <button
            type="button"
            class="mt-1 flex w-full items-center gap-1 text-left text-muted hover:text-body"
            [attr.aria-expanded]="expanded()"
            (click)="toggle()"
          >
            <!-- The summary IS the accessible name (§3.5). -->
            <span class="min-w-0 flex-1 truncate">{{ summary() }}</span>
            <span class="shrink-0 text-xs" aria-hidden="true">{{ expanded() ? '▲' : '▼' }}</span>
          </button>

          @if (expanded()) {
            <div class="mt-2 space-y-2 border-t border-line pt-2">
              <div>
                <p class="mb-1 text-xs font-medium text-muted">Input</p>
                <pre
                  class="overflow-x-auto rounded bg-surface p-2 font-mono text-xs text-body"
                >{{ formattedInput() }}</pre>
              </div>
              @if (state() === 'error') {
                <div>
                  <p class="mb-1 text-xs font-medium text-status-danger">Error</p>
                  <pre
                    class="overflow-x-auto rounded bg-surface p-2 font-mono text-xs text-status-danger"
                  >{{ error() }}</pre>
                </div>
              } @else if (state() === 'done') {
                <div>
                  <p class="mb-1 text-xs font-medium text-muted">Result</p>
                  <pre
                    class="overflow-x-auto rounded bg-surface p-2 font-mono text-xs text-body"
                  >{{ formattedResult() }}</pre>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <!--
        §3.2.4: a mutating tool never executes silently. Confirmation happens
        inside the chat, next to the exact arguments the agent proposed.
      -->
      @if (state() === 'awaiting-confirmation') {
        <div class="flex gap-2 border-t border-line px-3 py-2.5">
          <button
            type="button"
            class="min-h-11 flex-1 rounded-md bg-brand-teal px-3 text-sm font-medium text-ink-inverted"
            (click)="confirm.emit()"
          >
            Confirm
          </button>
          <button
            type="button"
            class="min-h-11 flex-1 rounded-md border border-line px-3 text-sm font-medium text-body"
            (click)="cancel.emit()"
          >
            Cancel
          </button>
        </div>
      }

      <!--
        A tool that produced a file needs a real control, not a URL in the
        result: the file sits behind an authenticated route, so a link to it
        cannot work. Generic on purpose — the card does not know what a report
        is; the caller supplies the label and handles the click.
      -->
      @if (state() === 'done' && downloadLabel(); as label) {
        <div class="border-t border-line px-3 py-2.5">
          <button
            type="button"
            class="min-h-11 w-full rounded-md border border-line px-3 text-sm font-medium text-body disabled:opacity-50"
            [disabled]="downloading()"
            (click)="download.emit()"
          >
            <span aria-hidden="true">⬇</span>
            {{ downloading() ? 'Downloading…' : label }}
          </button>
          <!-- Visible copy, not colour alone (WCAG 1.4.1) — and jobs live in
               server memory, so a restart makes this a genuine outcome. -->
          @if (downloadError(); as message) {
            <p class="mt-1.5 text-xs text-status-danger">{{ message }}</p>
          }
        </div>
      }

      <!--
        §3.2.6: a cancellable call shows a real Stop. The UI must visibly react
        within ~100ms, so the button emits immediately and the caller aborts.
      -->
      @if (state() === 'running' && cancellable()) {
        <div class="border-t border-line px-3 py-2.5">
          <button
            type="button"
            class="min-h-11 w-full rounded-md border border-line px-3 text-sm font-medium text-body"
            (click)="cancel.emit()"
          >
            Stop
          </button>
        </div>
      }
    </article>
  `,
})
export class ToolCallCard {
  /** Tool name, rendered in a monospace badge (§3.2.3). */
  readonly name = input.required<string>();
  /** One-line, human-readable description of what ran. */
  readonly summary = input.required<string>();
  readonly state = input<ToolCallState>('done');
  readonly input_ = input<unknown>(undefined, { alias: 'input' });
  readonly result = input<unknown>();
  readonly error = input<string>();
  readonly durationMs = input<number>();
  /** Set for cross-origin tools; renders the "via …" badge. */
  readonly origin = input<string>();
  /** Whether this tool changes state — drives the amber vs blue dot. */
  readonly mutates = input(false, { transform: booleanAttribute });
  /** The tool's `untrustedContentHint`: its result contains user-written text. */
  readonly untrusted = input(false, { transform: booleanAttribute });
  readonly cancellable = input(false, { transform: booleanAttribute });
  readonly startExpanded = input(false, { transform: booleanAttribute });
  /** Set to offer a download for a completed call; also the button's label. */
  readonly downloadLabel = input<string>();
  readonly downloading = input(false, { transform: booleanAttribute });
  readonly downloadError = input<string>();

  readonly confirm = output<void>();
  readonly cancel = output<void>();
  readonly download = output<void>();

  private readonly manuallyExpanded = signal<boolean | null>(null);

  /** Collapsed by default (§3.2.3), but an unconfirmed call opens itself so the
   * user sees the arguments before approving them. */
  readonly expanded = computed(
    () =>
      this.manuallyExpanded() ??
      (this.startExpanded() || this.state() === 'awaiting-confirmation'),
  );

  readonly formattedInput = computed(() => format(this.input_()));
  readonly formattedResult = computed(() => format(this.result()));

  toggle(): void {
    this.manuallyExpanded.set(!this.expanded());
  }
}

function format(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
