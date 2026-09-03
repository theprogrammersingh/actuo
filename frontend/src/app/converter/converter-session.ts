import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiClient } from '../core/api/api-client.js';
import { Copilot } from '../copilot/copilot.js';
import { ToolRegistry } from '../webmcp/tool-registry.js';

/** The subset of `GET /api/config` this service needs. */
interface ConverterConfig {
  converterUrl: string;
}

/** Schemes a framable converter can be served over. */
const FRAMABLE_SCHEMES = new Set(['https:', 'http:']);

/**
 * Owns the embedded converter: where it lives, which surface may show it, and
 * the cross-origin tool discovery that follows it around.
 *
 * Discovery used to belong to `/agent`, which was right while exactly one page
 * framed exactly one other origin. The converter appears on four surfaces now,
 * and page-owned discovery breaks the moment two overlap: navigating away
 * from `/agent` called `clearRemoteTools()` and stripped the Copilot's
 * converter tools while a converter was still mounted and visible elsewhere.
 *
 * Two responsibilities, both of which exist because a cross-origin tool lives
 * exactly as long as the document that registered it:
 *
 * 1. **Only one converter frame at a time.** `getTools()` returns one
 *    descriptor per *window*, so two live frames on the same origin publish two
 *    tools called `convertCurrency`. `Copilot.toolDeclarations()` would hand
 *    Gemini both, and `runTool()` resolves a call with `.find()` — first wins,
 *    arbitrarily. Opening one surface therefore closes any other.
 * 2. **Reference-counted discovery.** The first mount discovers, the last one
 *    to leave clears. The count is not always 0 or 1 even with rule 1: during a
 *    route change Angular constructs the incoming component before destroying
 *    the outgoing one, so a naive "clear on destroy" would wipe the tools the
 *    new surface just discovered.
 *
 * Modelled on {@link ToolSession}, which owns the state-gated `approve_expense`
 * lifecycle for the same reason: "which tools are published right now" is
 * session state, not component state.
 */
@Injectable({ providedIn: 'root' })
export class ConverterSession {
  private readonly api = inject(ApiClient);
  private readonly copilot = inject(Copilot);
  private readonly registry = inject(ToolRegistry);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** `null` until `/api/config` answers; `''` there means none configured. */
  private readonly url = signal<string | null>(null);
  private readonly mounts = signal(0);
  private readonly openSurface = signal<string | null>(null);
  private configLoaded: Promise<void> | null = null;
  private unsubscribeToolChange: (() => void) | null = null;

  /** The converter's base URL: `null` while unknown, `''` when unconfigured. */
  readonly converterUrl = this.url.asReadonly();

  /** True once `/api/config` has answered, however it answered. */
  readonly isResolved = computed(() => this.url() !== null);

  /**
   * The origin to hand `getTools({fromOrigins})`.
   *
   * Derived rather than configured separately: `CONVERTER_URL` may carry a path
   * — a converter need not sit at the root of its host — and two variables that
   * have to agree is one more than necessary.
   */
  readonly converterOrigin = computed(() => {
    const value = this.url();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      // A misconfigured variable must not become a `javascript:` frame src.
      if (!FRAMABLE_SCHEMES.has(parsed.protocol)) return '';
      return parsed.origin;
    } catch {
      // A malformed CONVERTER_URL must not take down the surfaces that read it.
      return '';
    }
  });

  /**
   * True when the converter is configured on this app's own origin.
   *
   * Worth saying out loud rather than showing a confident empty tool list:
   * `getTools()` returns this document's own tools too, and `Copilot`
   * deliberately filters same-origin descriptors out, so nothing would be
   * discovered and nothing would explain why.
   */
  readonly isSameOrigin = computed(() => {
    const origin = this.converterOrigin();
    return origin !== '' && origin === this.selfOrigin();
  });

  /** True once we know there is a framable converter on another origin. */
  readonly isAvailable = computed(() => this.converterOrigin() !== '' && !this.isSameOrigin());

  /**
   * The URL to frame, with this origin passed along so the converter can expose
   * its tools back to us.
   *
   * The `?actuo=` handshake is what the converter reads to decide who may call
   * its tools: a WebMCP tool is same-origin unless registration names an origin
   * in `exposedTo`, and the embedded page cannot know ours without being told.
   * Sending it at runtime rather than hardcoding it there means our hostname
   * can change without a release on the other side.
   */
  readonly frameUrl = computed(() => {
    const base = this.url();
    if (!base || !this.isAvailable()) return null;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}actuo=${encodeURIComponent(this.selfOrigin())}`;
  });

  /** Which surface currently owns the single converter frame. */
  readonly openedSurface = this.openSurface.asReadonly();

  /** Whether this particular surface is the one showing the converter. */
  isOpen(surface: string): boolean {
    return this.openSurface() === surface;
  }

  /**
   * Show the converter on `surface`, closing it wherever else it was.
   *
   * A radio group rather than a set, for rule 1 above.
   */
  open(surface: string): void {
    this.openSurface.set(surface);
  }

  /** Hide the converter if `surface` is the one showing it. */
  close(surface: string): void {
    if (this.isOpen(surface)) this.openSurface.set(null);
  }

  toggle(surface: string): void {
    if (this.isOpen(surface)) this.close(surface);
    else this.open(surface);
  }

  /**
   * Register a mounted converter frame. Returns a release function.
   *
   * Pairing acquire and release in one value is what stops a missed release
   * from pinning the tool list open forever.
   */
  acquire(): () => void {
    this.mounts.update((n) => n + 1);
    void this.ensureConfig().then(() => this.rediscover());

    if (!this.unsubscribeToolChange) {
      /*
       * The converter registers its tools asynchronously, after its own load
       * event and (being a React app) after hydration, so the iframe's `load`
       * can fire before there is anything to find. `toolchange` is what says
       * "now there is".
       */
      this.unsubscribeToolChange = this.registry.onToolChange(() => void this.rediscover());
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mounts.update((n) => Math.max(0, n - 1));
      if (this.mounts() === 0) this.teardown();
    };
  }

  /**
   * Re-run discovery. Safe to call at any time; a no-op when nothing is mounted
   * or no converter is reachable.
   *
   * Called on the iframe's `load`, on `toolchange`, and by `/agent`'s
   * Rediscover button.
   */
  async rediscover(): Promise<void> {
    const origin = this.converterOrigin();
    if (!this.isBrowser || this.mounts() === 0 || !origin || this.isSameOrigin()) return;
    await this.copilot.discoverRemoteTools([origin]);
  }

  /**
   * Load `/api/config` once per session.
   *
   * The promise is cached rather than the result, so several converters
   * mounting in the same tick make one request between them, not several.
   */
  ensureConfig(): Promise<void> {
    this.configLoaded ??= this.loadConfig();
    return this.configLoaded;
  }

  private async loadConfig(): Promise<void> {
    // Never during prerender: the origin is a runtime value, and an iframe in
    // the prerendered HTML would point somewhere the build cannot know.
    if (!this.isBrowser) {
      this.url.set('');
      return;
    }
    try {
      const config = await this.api.get<ConverterConfig>('/config');
      const value = typeof config?.converterUrl === 'string' ? config.converterUrl : '';
      this.url.set(value.replace(/\s+/g, ''));
    } catch {
      // No converter configured or the backend is down: the surfaces render
      // their unavailable state rather than the page failing. Nothing else
      // depends on this.
      this.url.set('');
    }
  }

  private teardown(): void {
    this.unsubscribeToolChange?.();
    this.unsubscribeToolChange = null;
    /*
     * `openSurface` is deliberately NOT cleared here. It is the user's intent —
     * "show me the converter on this surface" — while the mount count is a
     * resource. Coupling them broke going offline: the frame is released, this
     * ran, the surface closed, and the panel vanished instead of rendering the
     * "live rates need a connection" state. Coming back online then left it
     * closed, because nothing had asked for it any more.
     */
    /*
     * Without this the Copilot keeps offering `convertCurrency` to the model
     * after the document implementing it is gone, and every call fails with a
     * confusing error instead of the tool simply not being on the menu.
     */
    this.copilot.clearRemoteTools();
  }

  private selfOrigin(): string {
    return this.isBrowser ? (document.location?.origin ?? '') : '';
  }
}
