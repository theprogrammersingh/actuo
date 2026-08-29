import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    /*
     * PWA (PRD §8.4). Registration waits for the app to go stable so the worker
     * never competes with first paint or the Copilot's first render, and is off
     * in dev because a cached shell during a rebuild loop is a debugging trap.
     *
     * `ngsw-config.json` deliberately declares no `dataGroups`: caching `/api`
     * would show stale money and would quietly undercut the promise that every
     * read goes through an authenticated route. Only the shell and static
     * assets are cached.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
