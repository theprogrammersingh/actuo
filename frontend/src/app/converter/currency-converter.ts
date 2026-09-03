import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { PwaService } from '../core/pwa/pwa-service.js';
import { ToolRegistry } from '../webmcp/tool-registry.js';
import { ConverterSession } from './converter-session.js';

/**
 * The embedded currency converter.
 *
 * ## LOAD-BEARING: this component has no return channel, deliberately.
 *
 * It takes no `Expense`, emits no `output()`, listens for no `postMessage`, and
 * never reads a value back out of the frame. Rates go in one direction — onto
 * the screen, for a person to read.
 *
 * That is not an oversight, it is the enforcement. Actuo has no FX pass
 * (PRD §6.5): `converted_amount` is null for every foreign row, so totals count
 * base-currency rows only and *state what they left out* — `sumSpend()` returns
 * `{total, excluded}`, and `excludedNotice()` says so in words. The earlier
 * code added the raw `amount` instead, and a $200 charge was counted as ₹200 in
 * a rupee total.
 *
 * A live converter sitting next to those figures is exactly what tempts someone
 * to close that gap with the number on screen. Because no converted value ever
 * enters Actuo's component tree, there is nothing to wire in: doing it would
 * mean first inventing a return channel, which is a visible, reviewable act
 * rather than a one-line slip. **Do not add one.** A rate a person read off a
 * third-party site is not a locked historical rate, and only the backend
 * writing `converted_amount` at write time may make a row count.
 *
 * ## Why an iframe and not an API call
 *
 * The converter is a separate origin running its own WebMCP tool surface. The
 * frame is what makes those tools discoverable (PRD §7's cross-origin row):
 * `getTools({fromOrigins})` returns nothing unless a document from that origin
 * is alive, so the visible widget and the Copilot's ability to convert are the
 * same fact. It is also why this must not be a hidden frame — the tools it
 * exposes drive a UI, and driving a UI nobody can see is not a feature.
 */
@Component({
  selector: 'app-currency-converter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.isOpen(surface())) {
      @if (offline()) {
        <!--
          A cross-origin frame gives no usable error: it has no onerror, and its
          load event fires for the browser's own error page too. So this is
          gated on what we can actually know — the shell already tracks
          online/offline — rather than on detecting the failure afterwards.
        -->
        <p class="text-sm text-muted" role="status">
          Live rates need a connection. Actuo's own figures are all local, so the rest of this
          page is unaffected.
        </p>
      } @else if (session.isSameOrigin()) {
        <p class="text-sm text-muted">
          The converter is configured on this app's own origin, so nothing it exposes is
          cross-origin — <code class="font-mono">getTools()</code> returns its tools marked
          same-origin and the Copilot filters them out. Point
          <code class="font-mono">CONVERTER_URL</code> at a different host.
        </p>
      } @else if (frameUrl(); as url) {
        <p class="mb-3 text-xs text-muted">
          Embedded from <span class="font-mono text-body">{{ session.converterOrigin() }}</span>
          with <code class="font-mono">allow="tools"</code>. Rates are indicative, from the
          European Central Bank — they do not change any Actuo figure.
        </p>

        <iframe
          [title]="title()"
          class="w-full rounded-lg border border-line bg-canvas"
          [class]="heightClass()"
          allow="tools"
          referrerpolicy="no-referrer"
          [src]="url"
          (load)="onFrameLoad()"
        ></iframe>

        @if (!registry.isSupported()) {
          <p class="mt-3 text-sm text-muted">
            Use it directly above. This browser has no WebMCP, so the Copilot cannot drive it —
            that needs Chrome with
            <code class="font-mono">chrome://flags/#enable-webmcp-testing</code>.
          </p>
        }
      } @else if (session.isResolved()) {
        <p class="text-sm text-muted">
          No converter is configured. Set <code class="font-mono">CONVERTER_URL</code> to the
          base URL of one — it has to be a different origin than this app, or the tools it
          publishes come back same-origin and are filtered out.
        </p>
      }
    }
  `,
})
export class CurrencyConverter {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly pwa = inject(PwaService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly session = inject(ConverterSession);
  protected readonly registry = inject(ToolRegistry);

  /**
   * Stable id for this mount point — `'agent'`, `'convert'`, `'dashboard'`, or
   * `expense:<id>`. The session uses it to keep exactly one frame open.
   */
  readonly surface = input.required<string>();

  /** Accessible name for the frame. Every surface should say where it is. */
  readonly title = input('Currency converter');

  /** Taller on a page that is mostly this; compact in an inline panel. */
  readonly height = input<'compact' | 'full'>('compact');

  protected readonly offline = this.pwa.isOffline;
  protected readonly heightClass = computed(() =>
    this.height() === 'full' ? 'h-[32rem]' : 'h-80',
  );

  /**
   * `[src]` on an iframe is a RESOURCE_URL context, so Angular refuses an
   * interpolated string outright. Bypassing is the deliberate call here: the
   * URL comes from our own `GET /api/config`, never from user input or anything
   * an agent can influence, and `ConverterSession` has already rejected any
   * scheme that is not http(s). If it ever becomes user-supplied, this must
   * stop being a bypass.
   */
  protected readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.session.frameUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  constructor() {
    let release: (() => void) | null = null;

    /*
     * Claim the session only while this surface is actually showing the frame.
     * Mounting the component is not enough — three of the four surfaces render
     * it collapsed, and a claim then would discover tools for a document that
     * does not exist.
     */
    effect(() => {
      const shouldHold = this.session.isOpen(this.surface()) && !this.offline();
      if (shouldHold && !release) release = this.session.acquire();
      else if (!shouldHold && release) {
        release();
        release = null;
      }
    });

    // Resolve the URL even while collapsed, so a surface knows whether to offer
    // the trigger at all rather than opening onto an explanation.
    void this.session.ensureConfig();

    this.destroyRef.onDestroy(() => release?.());
  }

  /**
   * The frame's tools are registered after its own load — it is a separate app
   * that has to boot first — so this is a first attempt, not the only one.
   * `toolchange` is what catches the rest.
   */
  protected onFrameLoad(): void {
    void this.session.rediscover();
  }
}
