import { DOCUMENT, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PwaService } from './pwa-service.js';

/** A window stand-in that records listeners so tests can fire them. */
function createView(onLine = true) {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  return {
    navigator: { onLine },
    addEventListener(type: string, fn: (event: Event) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type: string, event: Partial<Event> = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event as Event);
    },
    has: (type: string) => listeners.has(type),
  };
}

function configure(view: ReturnType<typeof createView> | null, platform = 'browser') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: DOCUMENT, useValue: { defaultView: view } as unknown as Document },
    ],
  });
  return TestBed.inject(PwaService);
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  };
}

describe('PwaService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('install prompt', () => {
    it('offers nothing until the browser says it can', () => {
      expect(configure(createView()).canInstall()).toBe(false);
    });

    /**
     * Chrome shows its own mini-infobar unless the event is cancelled. Taking
     * it lets the app choose when to ask instead of covering the first screen.
     */
    it('captures and cancels beforeinstallprompt', () => {
      const view = createView();
      const pwa = configure(view);
      const event = installEvent();

      view.fire('beforeinstallprompt', event as unknown as Event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(pwa.canInstall()).toBe(true);
    });

    it('prompts and reports acceptance', async () => {
      const view = createView();
      const pwa = configure(view);
      const event = installEvent('accepted');
      view.fire('beforeinstallprompt', event as unknown as Event);

      await expect(pwa.install()).resolves.toBe(true);
      expect(event.prompt).toHaveBeenCalled();
    });

    /** `prompt()` is single-use, so the banner must not come back either way. */
    it('stops offering after a dismissal', async () => {
      const view = createView();
      const pwa = configure(view);
      view.fire('beforeinstallprompt', installEvent('dismissed') as unknown as Event);

      await expect(pwa.install()).resolves.toBe(false);
      expect(pwa.canInstall()).toBe(false);
    });

    it('does not reject when the browser refuses the prompt', async () => {
      const view = createView();
      const pwa = configure(view);
      const event = { ...installEvent(), prompt: vi.fn().mockRejectedValue(new Error('spent')) };
      view.fire('beforeinstallprompt', event as unknown as Event);

      await expect(pwa.install()).resolves.toBe(false);
    });

    it('resolves false with nothing captured', async () => {
      await expect(configure(createView()).install()).resolves.toBe(false);
    });

    it('stops offering once installed', () => {
      const view = createView();
      const pwa = configure(view);
      view.fire('beforeinstallprompt', installEvent() as unknown as Event);

      view.fire('appinstalled');

      expect(pwa.canInstall()).toBe(false);
    });

    it('can be dismissed without installing', () => {
      const view = createView();
      const pwa = configure(view);
      view.fire('beforeinstallprompt', installEvent() as unknown as Event);

      pwa.dismiss();

      expect(pwa.canInstall()).toBe(false);
    });
  });

  describe('connectivity', () => {
    it('starts from navigator.onLine', () => {
      expect(configure(createView(false)).isOffline()).toBe(true);
      expect(configure(createView(true)).isOffline()).toBe(false);
    });

    it('follows the online and offline events', () => {
      const view = createView();
      const pwa = configure(view);

      view.fire('offline');
      expect(pwa.isOffline()).toBe(true);

      view.fire('online');
      expect(pwa.isOffline()).toBe(false);
    });
  });

  describe('server-side rendering', () => {
    /**
     * The app server-renders. An unguarded `addEventListener` here would be a
     * production render crash, not a warning — and "offline" must never be the
     * server's answer, since it has no way to know.
     */
    it('registers nothing and reports online on the server', () => {
      const view = createView(false);
      const pwa = configure(view, 'server');

      expect(view.has('offline')).toBe(false);
      expect(pwa.isOffline()).toBe(false);
      expect(pwa.canInstall()).toBe(false);
    });

    it('survives a document with no window at all', () => {
      expect(() => configure(null)).not.toThrow();
    });
  });
});
