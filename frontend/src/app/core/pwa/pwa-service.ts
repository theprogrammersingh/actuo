import { DOCUMENT, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * The `beforeinstallprompt` event, which is not in lib.dom yet.
 *
 * Chromium-only, and feature-detected everywhere it is used: Safari and Firefox
 * never fire it, and on those the install banner simply never appears rather
 * than the page breaking.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The two things PRD §8.4 asks for beyond a manifest and a worker: an install
 * prompt, and knowing when the app is offline.
 *
 * Both are read-only signals plus one action, so the shell can render a banner
 * without owning any of this logic. Everything is guarded for SSR — the app
 * server-renders, and an unguarded `window.addEventListener` here is a
 * production render crash rather than a warning.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
  private readonly installed = signal(false);
  private readonly online = signal(true);

  /** True while the browser is willing to show an install prompt. */
  readonly canInstall = computed(() => this.deferredPrompt() !== null && !this.installed());
  /** False only once a network event has said so — never on a cold SSR render. */
  readonly isOffline = computed(() => !this.online());

  constructor() {
    if (!this.isBrowser) return;

    const view = this.document.defaultView;
    if (!view) return;

    this.online.set(view.navigator.onLine !== false);

    view.addEventListener('beforeinstallprompt', (event) => {
      // Chrome shows its own mini-infobar unless this is cancelled; taking the
      // event lets the app offer installation at a moment that makes sense
      // rather than over the first screen a user sees.
      event.preventDefault();
      this.deferredPrompt.set(event as BeforeInstallPromptEvent);
    });

    view.addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.deferredPrompt.set(null);
    });

    view.addEventListener('online', () => this.online.set(true));
    view.addEventListener('offline', () => this.online.set(false));
  }

  /**
   * Shows the browser's install prompt. Resolves to whether it was accepted.
   *
   * The saved event is single-use — the spec allows `prompt()` once — so it is
   * cleared either way, which is also what hides the banner afterwards.
   */
  async install(): Promise<boolean> {
    const event = this.deferredPrompt();
    if (!event) return false;

    this.deferredPrompt.set(null);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') this.installed.set(true);
      return outcome === 'accepted';
    } catch {
      // A prompt that was already consumed, or a browser that changed its mind.
      // Nothing to recover: the banner is gone and the app is unaffected.
      return false;
    }
  }

  /** Lets a user dismiss the banner without installing. */
  dismiss(): void {
    this.deferredPrompt.set(null);
  }
}
