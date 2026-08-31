import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

import { ApiClient } from '../../core/api/api-client.js';
import { Badge, Button, Card, EmptyState } from '../../ui';
import { Copilot } from '../../copilot/copilot.js';
import { ToolRegistry } from '../../webmcp/tool-registry.js';

/** The subset of `GET /api/config` this screen needs. */
interface AgentConfig {
  partnerOrigin: string;
}

/**
 * Agent tools — the WebMCP surface, made visible (PRD §7).
 *
 * Two things live here that had working, tested implementations and no caller,
 * so neither did anything in the running app:
 *
 *  1. **Cross-origin tool use.** `Copilot.discoverRemoteTools()` was never
 *     called, and the partner page was served from Actuo's own origin — so even
 *     if it had been, every descriptor would have come back same-origin and been
 *     filtered out. This screen embeds the partner page from its own origin
 *     (`PARTNER_DEMO_ORIGIN`, :4201 in dev) with `allow="tools"`, then asks
 *     `getTools({fromOrigins})` for what it exposes.
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
  imports: [Badge, Button, Card, EmptyState],
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
                Pageturner Books is an unrelated page that knows nothing about Actuo. It
                registers its own tools and exposes them to this origin, and the Copilot picks
                them up — the same widget, driving a site it was not built for.
              </p>
            </div>
            <button uiButton variant="secondary" size="sm" (click)="rediscover()">
              Rediscover
            </button>
          </div>
        </header>

        @if (!partnerOrigin()) {
          <!--
            The deployed default. Rather than an empty card, say what is missing
            and what the page still offers: the partner demo itself works from
            this origin, it just cannot prove anything about *cross*-origin.
          -->
          <p class="text-sm text-muted">
            No second origin is configured, so there is nothing cross-origin to discover. The
            partner page itself is still here —
            <a
              href="/partner-demo/"
              class="underline decoration-line underline-offset-2 hover:text-body"
              target="_blank"
              rel="noreferrer"
              >open it on this origin</a
            >
            — but its tools come back same-origin, which is the set the Copilot filters out.
          </p>
          <p class="mt-2 text-sm text-muted">
            To run the real demo, point <code class="font-mono">PARTNER_DEMO_ORIGIN</code> at a
            host that is not this one. Locally that is
            <code class="font-mono">npm run dev:partner</code> on :4201.
          </p>
        } @else if (sameOrigin()) {
          <!--
            Worth saying plainly rather than showing a confident empty list: with
            the partner page on this origin its tools come back marked
            same-origin, the Copilot filters them out, and nothing here would be
            cross-origin in any meaningful sense.
          -->
          <p class="text-sm text-muted">
            The partner page is configured on this app's own origin, so nothing it exposes is
            cross-origin. Set <code class="font-mono">PARTNER_DEMO_ORIGIN</code> to a different
            host — locally that is <code class="font-mono">npm run dev:partner</code> on
            :4201.
          </p>
        } @else if (partnerUrl(); as url) {
          <p class="mb-3 text-xs text-muted">
            Embedded from <span class="font-mono text-body">{{ partnerHost() }}</span> with
            <code class="font-mono">allow="tools"</code>.
          </p>

          <iframe
            title="Pageturner Books — WebMCP partner demo"
            class="h-64 w-full rounded-lg border border-line bg-canvas"
            allow="tools"
            referrerpolicy="no-referrer"
            [src]="url"
            (load)="rediscover()"
          ></iframe>

          @if (remoteTools().length === 0) {
            <p class="mt-3 text-sm text-muted">
              No tools discovered from that origin yet.
              @if (!registry.canExecuteCrossOrigin()) {
                Cross-origin discovery needs the Chrome flag above.
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
              The Copilot can use these now — ask it what
              <em>The Overstory</em> costs.
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
export class Agent {
  private readonly api = inject(ApiClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly copilot = inject(Copilot);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly registry = inject(ToolRegistry);
  private readonly destroyRef = inject(DestroyRef);

  /** `null` until `/api/config` answers; `''` there means no second origin. */
  protected readonly partnerOrigin = signal<string | null>(null);

  protected readonly remoteTools = this.copilot.crossOriginTools;
  protected readonly registeredNames = computed(() => this.registry.registeredNames().join(', '));

  /** Newest first — the call you just made is the one you are looking for. */
  protected readonly invocations = computed(() => [...this.registry.invocationLog()].reverse());

  protected readonly sameOrigin = computed(() => {
    const origin = this.partnerOrigin();
    return origin !== null && origin === this.selfOrigin();
  });

  protected readonly partnerHost = computed(() => hostOf(this.partnerOrigin() ?? ''));

  /**
   * `[src]` on an iframe is a RESOURCE_URL context, so Angular refuses an
   * interpolated string outright. Bypassing is the deliberate call here: the
   * origin comes from our own `GET /api/config`, never from user input or
   * anything an agent can influence, and the `?actuo=` value is this document's
   * own origin. If that ever becomes user-supplied, this must stop being a
   * bypass.
   */
  protected readonly partnerUrl = computed<SafeResourceUrl | null>(() => {
    const origin = this.partnerOrigin();
    if (!origin || this.sameOrigin()) return null;
    const url = `${origin}/partner-demo/?actuo=${encodeURIComponent(this.selfOrigin())}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    if (!this.isBrowser) return;

    void this.loadConfig();

    /*
     * Re-discover on `toolchange`. The partner page registers its tools
     * asynchronously after its own load, so the iframe's `load` event can fire
     * before there is anything to find; this is what catches the second beat.
     */
    const stop = this.registry.onToolChange(() => void this.rediscover());
    this.destroyRef.onDestroy(() => {
      stop();
      // The iframe is about to be torn down. Leaving its tools on the Copilot's
      // menu means the model keeps trying to call a document that is gone.
      this.copilot.clearRemoteTools();
    });
  }

  protected async rediscover(): Promise<void> {
    const origin = this.partnerOrigin();
    if (!origin || this.sameOrigin()) return;
    await this.copilot.discoverRemoteTools([origin]);
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

  private selfOrigin(): string {
    return this.isBrowser ? globalThis.location.origin : '';
  }

  private async loadConfig(): Promise<void> {
    try {
      const config = await this.api.get<AgentConfig>('/config');
      if (typeof config?.partnerOrigin === 'string' && config.partnerOrigin) {
        this.partnerOrigin.set(config.partnerOrigin.replace(/\/+$/, ''));
        /*
         * Discover straight away rather than waiting for the iframe's `load`
         * or a `toolchange`. The partner page may already be open in another
         * tab, in which case its tools are exposed to this origin right now
         * and neither of those events will ever fire.
         */
        await this.rediscover();
      }
    } catch {
      // No partner origin configured or the backend is down: the section stays
      // empty rather than the page failing. Nothing else here depends on it.
    }
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
