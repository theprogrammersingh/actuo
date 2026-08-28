import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { Session } from './session.js';

/**
 * Gate for the authenticated app.
 *
 * Waits on `ready()` before deciding. `Session.restore()` is asynchronous, so
 * without that wait a returning user with a valid refresh token gets bounced to
 * the login screen on every hard refresh — the session would simply not have
 * been restored yet at the moment the guard ran.
 */
export const authGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  if (!session.ready()) await session.restore();
  return session.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

/** Keeps an already-signed-in user off the login and signup screens. */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);

  if (!session.ready()) await session.restore();
  return session.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};
