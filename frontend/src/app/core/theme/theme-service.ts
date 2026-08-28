import { DOCUMENT } from '@angular/common';
import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

/** What the user asked for. `system` defers to `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What actually gets painted. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'actuo.theme';

/** Aurora Ledger is dark-first (§2.1) — the bare `:root` in styles.css is dark. */
const DEFAULT_THEME: ResolvedTheme = 'dark';

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

/**
 * Owns `data-theme` on `<html>`.
 *
 * SSR-safety is the load-bearing part. This app server-renders, so every
 * `document` / `localStorage` / `matchMedia` touch sits behind `isPlatformBrowser`.
 * On the server the service resolves to the dark default, creates no effect,
 * registers no media listener, and writes nothing — the browser then applies the
 * persisted preference during hydration.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Raw preference, including `system`. */
  private readonly preferenceSignal = signal<ThemePreference>('system');
  readonly preference = this.preferenceSignal.asReadonly();

  /** Live `prefers-color-scheme`. Stays at the dark default on the server. */
  private readonly systemTheme = signal<ResolvedTheme>(DEFAULT_THEME);

  /** The theme actually in effect. */
  readonly theme = computed<ResolvedTheme>(() => {
    const preference = this.preferenceSignal();
    return preference === 'system' ? this.systemTheme() : preference;
  });

  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    if (!this.isBrowser) {
      // Server render: resolve to the dark default and touch nothing.
      return;
    }

    this.preferenceSignal.set(this.readStoredPreference() ?? 'system');
    this.watchSystemTheme();

    effect(() => this.applyTheme(this.theme()));
  }

  /** Set the preference and persist it. `system` clears the stored override. */
  setPreference(preference: ThemePreference): void {
    this.preferenceSignal.set(preference);
    this.persistPreference(preference);
  }

  /**
   * Flip to the opposite of what is currently *painted*.
   *
   * Toggling off `system` is intentional: once someone reaches for the switch
   * they have expressed a preference, and silently reverting on the next OS
   * change would feel broken.
   */
  toggle(): void {
    this.setPreference(this.theme() === 'dark' ? 'light' : 'dark');
  }

  // --- browser-only internals ------------------------------------------------

  private applyTheme(theme: ResolvedTheme): void {
    if (!this.isBrowser) return;
    // Written explicitly for both values: `[data-theme='light']` drives the
    // override in styles.css, and an explicit `dark` keeps the attribute
    // truthful for anything else reading it.
    this.document.documentElement.setAttribute('data-theme', theme);
  }

  private readStoredPreference(): ThemePreference | null {
    const storage = this.storage();
    if (!storage) return null;
    try {
      const stored = storage.getItem(THEME_STORAGE_KEY);
      return isPreference(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  private persistPreference(preference: ThemePreference): void {
    const storage = this.storage();
    if (!storage) return;
    try {
      if (preference === 'system') {
        storage.removeItem(THEME_STORAGE_KEY);
      } else {
        storage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      // Private mode / storage disabled / quota. The theme still works for
      // this session; only persistence is lost, which is not worth throwing over.
    }
  }

  /** `localStorage` access itself throws in some privacy modes, hence the try. */
  private storage(): Storage | null {
    if (!this.isBrowser) return null;
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private watchSystemTheme(): void {
    const view = this.document.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return;

    const query = view.matchMedia('(prefers-color-scheme: light)');
    this.systemTheme.set(query.matches ? 'light' : 'dark');

    const onChange = (event: MediaQueryListEvent) => {
      this.systemTheme.set(event.matches ? 'light' : 'dark');
    };

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
  }
}
