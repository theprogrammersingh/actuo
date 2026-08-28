/**
 * The signed-in session (PRD §6.1). Import from here rather than reaching for
 * `session.js` directly, so guards and routes have one stable entry point.
 */
export { Session, SessionError, sessionErrorFrom, REFRESH_TOKEN_STORAGE_KEY } from './session.js';
export type { SessionErrorKind, SessionIdentity } from './session.js';
