import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { Badge, Button, Card, EmptyState } from '../../ui';
import { Copilot } from '../../copilot/copilot.js';
import { CurrencyConverter } from '../../converter/currency-converter.js';
import { ConverterSession } from '../../converter/converter-session.js';
import { ToolRegistry } from '../../webmcp/tool-registry.js';

/**
 * Agent tools — the WebMCP surface, made visible (PRD §7).
 *
 * Two things live here that had working, tested implementations and no caller,
 * so neither did anything in the running app:
 *
 *  1. **Cross-origin tool use.** `Copilot.discoverRemoteTools()` was never
 *     called, and the partner page was served from Actuo's own origin — so even
 *     if it had been, every descriptor would have come back same-origin and been
 *     filtered out. This screen embeds the currency converter from its own
 *     origin (`CONVERTER_URL`, the local partner page on :4201 in dev) with
 *     `allow="tools"`, then asks `getTools({fromOrigins})` for what it exposes.
 *
 *     The frame and the discovery lifecycle belong to `ConverterSession`, not to
 *     this page: the converter also appears on `/convert`, the dashboard and
 *     foreign-currency expense rows, and page-owned teardown would clear the
 *     Copilot's remote tools while a frame was still mounted somewhere else.
 *  2. **The manual debug panel.** `ToolRegistry.discoveredTools()` and
 *     `invocationLog()` had no consumer. They are the two panels below, and
 *     they are what makes "the agent did exactly this" inspectable rather than
 *     asserted.
 *
 * Everything here degrades honestly. Cross-origin genuinely cannot be
 * polyfilled — `registerTool` with `exposedTo` throws `NotSupportedError` under
 * the polyfill — so without the Chrome flag this screen says exactly what is
 * missing rather than showing an empty list that reads as a bug. The rest of
 * Actuo keeps working: the in-page Copilot calls tools through the registry's
 * local `execute` functions, which need no flag at all.
 */
@Component({
  selector: 'app-agent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Button, Card, CurrencyConverter, EmptyState, RouterLink],
  host: { class: 'block' },
  template: `
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 class="font-display text-2xl font-semibold text-body">Agent tools</h1>
        <p class="mt-1.5 text-sm text-muted">
          What this page exposes to an AI agent, what it can reach on other sites, and every
          tool call that has run in this session.
        </p>
      </header>

      <!-- Browser support ------------------------------------------------- -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-3">
          <h2 class="font-display text-lg font-semibold text-body">This browser</h2>
        </header>

        <dl class="grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs font-medium tracking-wide text-muted uppercase">WebMCP</dt>
            <dd class="mt-1">
              <ui-badge
                [tone]="registry.isSupported() ? 'success' : 'warning'"
                [label]="registry.isSupported() ? 'Available' : 'Not available'"
              />
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium tracking-wide text-muted uppercase">
              Cross-origin calls
            </dt>
            <dd class="mt-1">
              <ui-badge
                [tone]="registry.canExecuteCrossOrigin() ? 'success' : 'warning'"
                [label]="registry.canExecuteCrossOrigin() ? 'Available' : 'Not available'"
              />
            </dd>
          </div>
        </dl>

        @if (!registry.isSupported()) {
          <p class="mt-4 text-sm text-muted">
            This browser has no <code class="font-mono">document.modelContext</code>, so nothing
            is published to external agents. Actuo itself is unaffected — the Copilot calls its
            tools directly and needs no flag.
          </p>
        } @else if (!registry.canExecuteCrossOrigin()) {
          <p class="mt-4 text-sm text-muted">
            <code class="font-mono">executeTool()</code> is a Chromium extension to the spec and
            is the only way to call a tool this page does not own. Enable
            <code class="font-mono">chrome://flags/#enable-webmcp-testing</code> to run the
            cross-origin demo below. Everything else on this page works without it.
          </p>
        }

        <p class="mt-4 text-sm text-muted">
          Published by this page:
          <span class="font-mono text-body">{{ registeredNames() || 'nothing yet' }}</span>
        </p>
      </ui-card>

      <!-- Cross-origin demo ------------------------------------------------ -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-display text-lg font-semibold text-body">Another site's tools</h2>
              <p class="mt-1 text-sm text-muted">
                The currency converter below is a separate app on its own origin that knows
                nothing about Actuo. It registers its own tools, exposes them to this origin,
                and the Copilot picks them up — the same widget, driving a site it was not
                built for.
              </p>
            </div>
            <button uiButton variant="secondary" size="sm" (click)="rediscover()">
              Rediscover
            </button>
          </div>
        </header>

        <app-currency-converter
          [surface]="surface"
          title="Currency converter — cross-origin WebMCP demo"
        />

        <p class="mt-3 text-xs text-muted">
          The same converter has
          <a
            routerLink="/convert"
            class="underline decoration-line underline-offset-2 hover:text-body"
            >a page of its own</a
          >, and appears on expense rows filed in another currency.
        </p>

        @if (session.isAvailable()) {
          @if (remoteTools().length === 0) {
            <p class="mt-3 text-sm text-muted">
              No tools discovered from that origin yet.
              @if (!registry.canExecuteCrossOrigin()) {
                Cross-origin discovery needs the Chrome flag above.
              } @else {
                A site's tools are same-origin unless it registers them with
                <code class="font-mono">exposedTo</code> naming this origin — the converter is
                told which origin that is by the
                <code class="font-mono">?actuo=</code> parameter on the frame above.
              }
            </p>
          } @else {
            <ul class="mt-3 divide-y divide-line">
              @for (tool of remoteTools(); track tool.name) {
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <ui-badge
                    [tone]="tool.annotations?.readOnlyHint ? 'neutral' : 'warning'"
                    [label]="tool.annotations?.readOnlyHint ? 'Read-only' : 'Mutating'"
                  />
                  @if (tool.annotations?.untrustedContentHint) {
                    <ui-badge tone="warning" label="Untrusted text" />
                  }
                  <span class="font-mono text-sm text-body">{{ tool.name }}</span>
                  <span class="ml-auto text-xs text-muted">via {{ hostOf(tool.origin) }}</span>
                  <p class="w-full text-xs text-muted">{{ tool.description }}</p>
                </li>
              }
            </ul>
            <p class="mt-3 text-sm text-muted">
              The Copilot can use these now — ask it what €80 is in rupees. The answer is that
              site's, quoted with its rate and date; it never becomes an Actuo figure.
            </p>
          }
        }
      </ui-card>

      <!-- Invocation log --------------------------------------------------- -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-3">
          <h2 class="font-display text-lg font-semibold text-body">Tool calls this session</h2>
          <p class="mt-1 text-sm text-muted">
            Live, in-memory, newest first. The durable record is in Settings → Audit log.
          </p>
        </header>

        @if (invocations().length === 0) {
          <ui-empty-state
            heading="Nothing has run yet"
            message="Ask the Copilot to do something and every call it makes shows up here, with
                     what went in and what came back."
            [headingLevel]="3"
          />
        } @else {
          <ul class="divide-y divide-line">
            @for (call of invocations(); track call.startedAt + call.toolName) {
              <li class="py-3">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <ui-badge
                    [tone]="call.error ? 'danger' : 'success'"
                    [label]="call.error ? 'Failed' : 'Ran'"
                  />
                  <span class="font-mono text-sm text-body">{{ call.toolName }}</span>
                  @if (call.origin === 'cross-origin') {
                    <ui-badge tone="info" label="Cross-origin" />
                  }
                  <span class="tabular ml-auto text-xs text-muted">{{ call.durationMs }}ms</span>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted">
                  {{ preview(call.input) }}
                </p>
                <p class="truncate font-mono text-xs text-muted">
                  {{ call.error ?? preview(call.output) }}
                </p>
              </li>
            }
          </ul>
        }
      </ui-card>
    </section>
  `,
})
export class Agent implements OnInit {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly copilot = inject(Copilot);

  protected readonly registry = inject(ToolRegistry);
  protected readonly session = inject(ConverterSession);

  /** The surface id this page claims. See `ConverterSession.open`. */
  protected readonly surface = 'agent';

  protected readonly remoteTools = this.copilot.crossOriginTools;
  protected readonly registeredNames = computed(() => this.registry.registeredNames().join(', '));

  /** Newest first — the call you just made is the one you are looking for. */
  protected readonly invocations = computed(() => [...this.registry.invocationLog()].reverse());

  protected readonly converterHost = computed(() => hostOf(this.session.converterOrigin()));

  ngOnInit(): void {
    if (!this.isBrowser) return;
    /*
     * This page's job is to make the cross-origin surface visible, so it opens
     * the frame rather than offering a trigger. `ConverterSession` owns the
     * discovery lifecycle from here — including the `toolchange` subscription
     * and the teardown that used to live in this constructor. It has to, now
     * that the converter also appears on the dashboard and on expense rows:
     * page-owned teardown would clear the Copilot's tools while a frame was
     * still mounted and visible somewhere else.
     */
    this.session.open(this.surface);
  }

  /** The Rediscover button. */
  protected rediscover(): void {
    void this.session.rediscover();
  }

  protected hostOf(origin: string): string {
    return hostOf(origin);
  }

  /** One line of a payload — this panel is scanned, not read. */
  protected preview(value: unknown): string {
    if (value === null || value === undefined) return '—';
    let text: string;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return '—';
    }
    if (!text) return '—';
    return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  }

}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
