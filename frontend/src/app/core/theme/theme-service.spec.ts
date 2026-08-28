import { DOCUMENT } from '@angular/common';
import { ApplicationRef, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { THEME_STORAGE_KEY, ThemeService } from './theme-service';

/** Flushes root effects in a zoneless TestBed. */
function flush(): void {
  TestBed.inject(ApplicationRef).tick();
}

function html(): HTMLElement {
  return TestBed.inject(DOCUMENT).documentElement;
}

describe('ThemeService', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  describe('server platform', () => {
    /**
     * A booby-trapped document: every property the service could reach for
     * throws. If any SSR path touches the DOM, these tests fail loudly rather
     * than silently regressing into a production render crash.
     */
    function bootServer() {
      const trap = {
        get documentElement(): never {
          throw new Error('documentElement was touched during SSR');
        },
        get defaultView(): never {
          throw new Error('defaultView was touched during SSR');
        },
      };

      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: DOCUMENT, useValue: trap as unknown as Document },
        ],
      });

      return TestBed.inject(ThemeService);
    }

    it('constructs without touching document', () => {
      expect(() => bootServer()).not.toThrow();
    });

    it('does not read localStorage', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      bootServer();
      expect(getItem).not.toHaveBeenCalled();
    });

    it('resolves to the dark default, since Aurora Ledger is dark-first', () => {
      const service = bootServer();
      expect(service.isBrowser).toBe(false);
      expect(service.theme()).toBe('dark');
      expect(service.isDark()).toBe(true);
    });

    it('still tracks preference changes without writing to the DOM or storage', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const service = bootServer();

      expect(() => service.setPreference('light')).not.toThrow();

      expect(service.preference()).toBe('light');
      expect(service.theme()).toBe('light');
      expect(setItem).not.toHaveBeenCalled();
    });

    it('does not crash when toggled during a server render', () => {
      const service = bootServer();
      expect(() => service.toggle()).not.toThrow();
      expect(service.theme()).toBe('light');
    });
  });

  describe('browser platform', () => {
    function boot(): ThemeService {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ThemeService);
      flush();
      return service;
    }

    it('defaults to the system preference when nothing is stored', () => {
      const service = boot();
      expect(service.preference()).toBe('system');
      // jsdom reports no match for `(prefers-color-scheme: light)`, so: dark.
      expect(service.theme()).toBe('dark');
    });

    it('writes the resolved theme to <html data-theme>', () => {
      const service = boot();
      expect(html().getAttribute('data-theme')).toBe('dark');

      service.setPreference('light');
      flush();
      expect(html().getAttribute('data-theme')).toBe('light');
    });

    it('persists an explicit preference and drops it again for "system"', () => {
      const service = boot();

      service.setPreference('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

      service.setPreference('system');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('restores a stored preference on construction', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      const service = boot();

      expect(service.preference()).toBe('light');
      expect(service.theme()).toBe('light');
      expect(html().getAttribute('data-theme')).toBe('light');
    });

    it('ignores junk in storage rather than throwing', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
      const service = boot();
      expect(service.preference()).toBe('system');
    });

    it('toggle flips the painted theme and pins it off "system"', () => {
      const service = boot();
      expect(service.preference()).toBe('system');

      service.toggle();
      expect(service.preference()).toBe('light');
      expect(service.theme()).toBe('light');

      service.toggle();
      expect(service.theme()).toBe('dark');
      expect(service.preference()).toBe('dark');
    });

    it('survives localStorage throwing (private mode) without losing the theme', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const service = boot();
      expect(() => service.setPreference('light')).not.toThrow();
      flush();

      expect(service.theme()).toBe('light');
      expect(html().getAttribute('data-theme')).toBe('light');
    });
  });
});
