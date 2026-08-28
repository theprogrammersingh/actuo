import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToolCallCard } from '../ui/tool-call-card';
import { Copilot } from './copilot';

/**
 * The Copilot: an idle aurora orb that opens into a conversation.
 *
 * Layout follows Design Doc §3.1 — a full-screen sheet on a phone, because a
 * cramped chat panel is unusable at that size, and a floating, never
 * modal-blocking panel from `sm:` up.
 *
 * The orb is the one place §3.4 permits a long ambient animation; the global
 * `prefers-reduced-motion` rule in styles.css disables it.
 */
@Component({
  selector: 'app-copilot-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ToolCallCard, RouterLink],
  styles: [
    `
      @keyframes breathe {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.92;
        }
        50% {
          transform: scale(1.06);
          opacity: 1;
        }
      }
      .orb {
        animation: breathe 3.4s ease-in-out infinite;
      }
    `,
  ],
  template: `
    @if (!copilot.isOpen()) {
      <button
        type="button"
        class="orb bg-aurora fixed right-4 bottom-20 z-40 size-14 rounded-full shadow-glow-violet sm:bottom-6"
        aria-label="Open Actuo Copilot"
        (click)="copilot.toggle()"
      >
        <span class="text-xl" aria-hidden="true">✦</span>
      </button>
    } @else {
      <div
        class="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[32rem] sm:w-96 sm:rounded-xl sm:border sm:border-line sm:shadow-glow-violet"
        role="dialog"
        aria-label="Actuo Copilot"
        (keydown.escape)="copilot.close()"
      >
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <span class="bg-aurora size-6 rounded-full" aria-hidden="true"></span>
          <h2 class="flex-1 font-medium">Copilot</h2>
          @if (copilot.isBusy()) {
            <button
              type="button"
              class="min-h-11 rounded-md border border-line px-3 text-sm"
              (click)="copilot.stop()"
            >
              Stop
            </button>
          }
          <button
            type="button"
            class="min-h-11 px-2 text-muted hover:text-body"
            aria-label="Close Copilot"
            (click)="copilot.close()"
          >
            ✕
          </button>
        </header>

        <div #scroller class="flex-1 space-y-3 overflow-y-auto p-4">
          @if (copilot.entries().length === 0) {
            @if (copilot.needsKey()) {
              <!-- PRD §6.8: with no key, open into setup rather than failing silently. -->
              <div class="rounded-lg border border-line bg-card p-4 text-sm">
                <p class="mb-1 font-medium">Add your Gemini key to get started</p>
                <p class="mb-3 text-muted">
                  Your key is stored only in this browser and is never sent to Actuo's servers.
                </p>
                <a
                  routerLink="/settings"
                  class="inline-flex min-h-11 items-center rounded-md bg-brand-teal px-3 text-sm font-medium text-ink-inverted"
                  (click)="copilot.close()"
                >
                  Open Settings
                </a>
              </div>
            } @else {
              <div class="space-y-2 text-sm text-muted">
                <p>Ask me to do things, and you'll see every tool I run.</p>
                <ul class="space-y-1.5">
                  @for (example of examples; track example) {
                    <li>
                      <button
                        type="button"
                        class="w-full rounded-md border border-line bg-card px-3 py-2 text-left hover:text-body"
                        (click)="submit(example)"
                      >
                        {{ example }}
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          }

          @for (entry of copilot.entries(); track entry.id) {
            @switch (entry.kind) {
              @case ('user') {
                <p class="ml-auto max-w-[85%] rounded-lg bg-card px-3 py-2 text-sm">
                  {{ entry.text }}
                </p>
              }
              @case ('assistant') {
                <p class="max-w-[90%] text-sm whitespace-pre-wrap">{{ entry.text }}</p>
              }
              @case ('error') {
                <div class="rounded-lg border border-status-danger/40 bg-card p-3 text-sm">
                  <p class="text-status-danger">{{ entry.text }}</p>
                  @if (entry.keyProblem) {
                    <a routerLink="/settings" class="mt-1 inline-block underline" (click)="copilot.close()">
                      Open Settings
                    </a>
                  }
                </div>
              }
              @case ('tool') {
                <ui-tool-call-card
                  [name]="entry.name"
                  [summary]="entry.summary"
                  [state]="entry.state"
                  [input]="entry.input"
                  [result]="entry.result"
                  [error]="entry.error"
                  [durationMs]="entry.durationMs"
                  [origin]="entry.origin"
                  [mutates]="entry.mutates"
                  [cancellable]="entry.cancellable"
                  (confirm)="copilot.respondToConfirmation(true)"
                  (cancel)="onCancel(entry.state)"
                />
              }
            }
          }
        </div>

        <form class="flex gap-2 border-t border-line p-3" (submit)="onSubmit($event)">
          <label class="sr-only" for="copilot-input">Message the Copilot</label>
          <input
            id="copilot-input"
            class="min-h-11 flex-1 rounded-md border border-line bg-card px-3 text-sm text-body"
            placeholder="Ask, or tell me what to log…"
            autocomplete="off"
            [value]="draft()"
            (input)="draft.set($any($event.target).value)"
          />
          <button
            type="submit"
            class="min-h-11 rounded-md bg-brand-teal px-4 text-sm font-medium text-ink-inverted disabled:opacity-50"
            [disabled]="copilot.isBusy() || !draft().trim()"
          >
            Send
          </button>
        </form>
      </div>
    }
  `,
})
export class CopilotPanel {
  protected readonly copilot = inject(Copilot);
  protected readonly draft = signal('');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly examples = [
    'What did I spend on travel last month?',
    'I spent ₹450 on lunch at Barista yesterday',
    'How are my budgets looking?',
  ];

  constructor() {
    // Keep the newest message in view as the conversation grows.
    effect(() => {
      this.copilot.entries();
      const element = this.scroller()?.nativeElement;
      if (element) queueMicrotask(() => (element.scrollTop = element.scrollHeight));
    });
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit(this.draft());
  }

  protected submit(text: string): void {
    if (!text.trim()) return;
    this.draft.set('');
    void this.copilot.send(text);
  }

  /**
   * Cancel means two different things on a card: decline a proposed action, or
   * stop work already running. Both are the same button to the user.
   */
  protected onCancel(state: string): void {
    if (state === 'awaiting-confirmation') this.copilot.respondToConfirmation(false);
    else this.copilot.stop();
  }
}
